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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
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

  const { data: subs, error: subsError } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth_key')
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

  const pushPayload = JSON.stringify({
    title: titleForNotification(notif),
    body: notif.message,
    url: urlForNotification(notif),
    tag: `geek-${notif.type}-${notif.id}`,
  });

  // 並列送信。失敗 endpoint (410 Gone) は DB から消す。
  const results = await Promise.allSettled(
    subList.map(async (s) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh, auth: s.auth_key },
          },
          pushPayload,
        );
        return { id: s.id, ok: true };
      } catch (err: unknown) {
        // 失効した endpoint は削除
        const statusCode =
          typeof err === 'object' && err !== null && 'statusCode' in err
            ? (err as { statusCode: number }).statusCode
            : 0;
        if (statusCode === 404 || statusCode === 410) {
          await admin.from('push_subscriptions').delete().eq('id', s.id);
        }
        return { id: s.id, ok: false, statusCode };
      }
    }),
  );

  const delivered = results.filter(
    (r) => r.status === 'fulfilled' && r.value.ok,
  ).length;

  return new Response(
    JSON.stringify({ delivered, total: subList.length }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
