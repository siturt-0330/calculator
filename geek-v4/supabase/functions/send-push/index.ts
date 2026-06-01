// ============================================================
// send-push: Web Push 配信 edge function (skeleton)
// ============================================================
// Database Webhook で notifications テーブルの INSERT を受け取り、
// その user_id に紐づく push_subscriptions 全部に Web Push を送信する。
// 'official_post' タイプにフォーカスしているが、他タイプも同じパスを通る。
//
// ─── Setup ──────────────────────────────────────────────────
// 1. VAPID 鍵を生成:
//      npx web-push generate-vapid-keys
//
// 2. Supabase secrets を設定:
//      supabase secrets set VAPID_PUBLIC_KEY=<public>
//      supabase secrets set VAPID_PRIVATE_KEY=<private>
//      supabase secrets set VAPID_SUBJECT=mailto:admin@geek.app
//
// 3. デプロイ:
//      supabase functions deploy send-push --project-ref <YOUR_REF>
//
// 4. Studio で Database Webhook を作成:
//      - Table: notifications
//      - Events: INSERT
//      - URL: https://<ref>.functions.supabase.co/send-push
//      - Method: POST
//      - HTTP Headers: Authorization: Bearer <anon or function secret>
//
// ─── Webhook payload (Supabase format) ─────────────────────
//   {
//     type: 'INSERT',
//     table: 'notifications',
//     record: { id, user_id, type, tag_name, message, ... },
//     schema: 'public',
//     old_record: null
//   }
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
// Deno で web-push を使う (npm: 接頭辞で Node 互換 import)
import webpush from 'npm:web-push@3.6.7';
import { buildCorsHeaders } from '../_shared/cors.ts';

// Webhook 認証用 shared secret (Supabase secret として設定):
//   supabase secrets set PUSH_WEBHOOK_SECRET=<long-random-string>
// Database Webhook の HTTP Headers にも同じ secret を:
//   Authorization: Bearer <PUSH_WEBHOOK_SECRET>
const PUSH_WEBHOOK_SECRET = Deno.env.get('PUSH_WEBHOOK_SECRET') ?? '';

type NotificationRow = {
  id: string;
  user_id: string;
  type: string;
  tag_name: string | null;
  message: string;
};

type WebhookPayload = {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  schema: string;
  record: NotificationRow | null;
  old_record: NotificationRow | null;
};

type PushSubRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
  platform: string;  // 'web' | 'ios' | 'android'
};

// VAPID 設定 — 起動時に一度だけ
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@geek.app';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// 定数時間比較 — Authorization ヘッダ等の secret 比較で timing attack を防ぐ。
// 通常の `===` は engine 依存で early-exit する可能性があり、攻撃者がレスポンス時間から
// 一致 prefix 長を推測できる余地がある。下記は max length まで必ずループし、
// 長さの違いも XOR 結果に反映する。
function timingSafeEqual(a: string, b: string): boolean {
  const al = a.length;
  const bl = b.length;
  const maxLen = Math.max(al, bl);
  let mismatch = al ^ bl;
  for (let i = 0; i < maxLen; i++) {
    const ac = i < al ? a.charCodeAt(i) : 0;
    const bc = i < bl ? b.charCodeAt(i) : 0;
    mismatch |= ac ^ bc;
  }
  return mismatch === 0;
}

// type → クライアント遷移先 URL のマッピング (service worker の notification.data に渡す)
function urlForNotification(n: NotificationRow): string {
  switch (n.type) {
    case 'official_post':
      // クライアントの notifications 画面側で community 名→id ルックアップして遷移するが、
      // web push 直クリック時はインタラクティブにルックアップできないので
      // /notifications に着地させる (そこから tap で community 詳細へ)。
      return '/notifications';
    case 'like':
    case 'comment':
    case 'reply':
      return '/notifications';
    case 'follow':
      return '/mypage';
    default:
      return '/';
  }
}

function titleForNotification(n: NotificationRow): string {
  switch (n.type) {
    case 'official_post':
      return n.tag_name ? `📣 ${n.tag_name}` : '📣 公式コミュニティのお知らせ';
    case 'like':       return '💛 いいね';
    case 'comment':    return '💬 コメント';
    case 'reply':      return '↩ 返信';
    case 'follow':     return '👤 新しいフォロワー';
    default:           return '🔔 Geek';
  }
}

// ============================================================
// 通知設定 (push) 判定 — lib/utils/notificationFilter.ts と同ロジックを移植
// (Edge Function は外部 import をバンドルしないため同等ロジックをここに置く)
// ============================================================
const KNOWN_CATEGORIES = [
  'like', 'comment', 'reply', 'mention', 'follow',
  'friend_request', 'friend_accept', 'official_post',
  'event', 'mod_action', 'system',
];
function notificationCategoryFor(type: string): string {
  return KNOWN_CATEGORIES.includes(type) ? type : 'system';
}
// 該当カテゴリの pref が無ければ fail-open=true (設定漏れで重要通知を握りつぶさない)
function shouldSendPushForType(
  type: string,
  prefs: { category: string; push: boolean }[],
): boolean {
  const category = notificationCategoryFor(type);
  const pref = prefs.find((p) => p.category === category);
  if (!pref) return true;
  return pref.push;
}

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // ============================================================
  // Webhook 認証 — fail-closed (Audit B#9, J#5 — 2026-05-28)
  // ============================================================
  // 旧実装は `if (PUSH_WEBHOOK_SECRET) { check }` で、env が空のときに
  // 認証チェックを丸ごとスキップしていた。Edge Function の URL が露見した
  // 瞬間に誰でも任意 user に push を撃てる状態 (= URL 知った攻撃者が
  // notifications テーブル形式の JSON を POST するだけで通る)。
  //
  // 対策: secret が未設定なら 503 を返し、設定済みなら必ず比較する。
  // production deploy 前に必ず `supabase secrets set PUSH_WEBHOOK_SECRET=...`
  // しておくこと。Database Webhook 側の Authorization ヘッダにも同値を入れる。
  // ============================================================
  if (!PUSH_WEBHOOK_SECRET) {
    console.error('[send-push] PUSH_WEBHOOK_SECRET not configured — refusing to process');
    return new Response(
      JSON.stringify({ ok: false, error: 'push webhook not configured' }),
      { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
  {
    const auth = req.headers.get('authorization') ?? '';
    const expected = `Bearer ${PUSH_WEBHOOK_SECRET}`;
    // 定数時間比較で timing attack を防ぐ (§ timingSafeEqual)
    if (!timingSafeEqual(auth, expected)) {
      return new Response(
        JSON.stringify({ error: 'unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
  }

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return new Response(
      JSON.stringify({ error: 'VAPID keys not configured' }),
      { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  let payload: WebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'invalid json' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // INSERT 以外は無視
  if (payload.type !== 'INSERT' || payload.table !== 'notifications' || !payload.record) {
    return new Response(JSON.stringify({ skipped: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const notif = payload.record;

  // Service role でユーザーの購読を取得
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // 通知設定 (push) を確認 — off のカテゴリは一切配信しない (#6)。
  // prefs に該当カテゴリが無ければ fail-open=true (設定漏れで重要通知を握りつぶさない)。
  const { data: prefRows } = await admin
    .from('notification_preferences')
    .select('category, push')
    .eq('user_id', notif.user_id);
  if (!shouldSendPushForType(notif.type, (prefRows ?? []) as { category: string; push: boolean }[])) {
    return new Response(JSON.stringify({ delivered: 0, skipped: 'push-pref-off' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: subs, error: subsError } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth_key, platform')
    .eq('user_id', notif.user_id);

  if (subsError) {
    return new Response(
      JSON.stringify({ error: subsError.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const subList = (subs ?? []) as PushSubRow[];
  if (subList.length === 0) {
    return new Response(JSON.stringify({ delivered: 0 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const title = titleForNotification(notif);
  const url = urlForNotification(notif);
  const pushPayload = JSON.stringify({
    title,
    body: notif.message,
    url,
    tag: `geek-${notif.type}-${notif.id}`,
  });

  // platform で分岐 (#7): web は Web Push、ios/android は Expo Push API。
  // 旧実装は全 sub を webpush に渡していたため、native の Expo token は必ず失敗し、
  // しかも失効削除条件 (404/410) にも当たらず dead row が残り続けていた。
  const webSubs = subList.filter((s) => s.platform === 'web');
  const nativeSubs = subList.filter((s) => s.platform === 'ios' || s.platform === 'android');

  // ----- Web Push -----
  const webResults = await Promise.allSettled(
    webSubs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } },
          pushPayload,
        );
        return true;
      } catch (err: unknown) {
        // 失効した endpoint (404/410) は DB から消す
        const statusCode =
          typeof err === 'object' && err !== null && 'statusCode' in err
            ? (err as { statusCode: number }).statusCode
            : 0;
        if (statusCode === 404 || statusCode === 410) {
          await admin.from('push_subscriptions').delete().eq('id', s.id);
        }
        return false;
      }
    }),
  );
  const webDelivered = webResults.filter((r) => r.status === 'fulfilled' && r.value).length;

  // ----- Native (Expo Push API) -----
  let nativeDelivered = 0;
  if (nativeSubs.length > 0) {
    try {
      const messages = nativeSubs.map((s) => ({
        to: s.endpoint,
        title,
        body: notif.message,
        data: { url },
        sound: 'default',
      }));
      const resp = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(messages),
      });
      if (resp.ok) {
        const json = await resp.json();
        const tickets = Array.isArray(json?.data) ? json.data : [];
        for (let i = 0; i < tickets.length; i++) {
          const t = tickets[i];
          if (t?.status === 'ok') {
            nativeDelivered++;
          } else if (
            t?.status === 'error' &&
            t?.details?.error === 'DeviceNotRegistered' &&
            nativeSubs[i]
          ) {
            // 失効した Expo token は削除
            await admin.from('push_subscriptions').delete().eq('id', nativeSubs[i].id);
          }
        }
      } else {
        console.error('[send-push] expo push http error:', resp.status);
      }
    } catch (e) {
      console.error('[send-push] expo push failed:', e);
    }
  }

  const delivered = webDelivered + nativeDelivered;

  return new Response(
    JSON.stringify({ delivered, total: subList.length, web: webDelivered, native: nativeDelivered }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
