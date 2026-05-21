// ============================================================
// Web Push subscription API
// ============================================================
// migration 0035 で作成された public.push_subscriptions テーブルを
// 操作するクライアントサイド API。VAPID 鍵で署名された Push を
// 受け取るための endpoint / p256dh / auth_key を保存する。
//
// ─── VAPID 鍵 セットアップ手順 (deploy 担当者向け) ───────────
// 1. ローカルで鍵ペアを生成:
//      npx web-push generate-vapid-keys
//    → public/private のペアが出る。
//
// 2. クライアント側 (.env / EAS secret):
//      EXPO_PUBLIC_VAPID_PUBLIC_KEY=<public key>
//    Expo は EXPO_PUBLIC_* だけクライアントバンドルに inline する。
//    private key は **絶対に EXPO_PUBLIC_ にしない**。
//
// 3. サーバー側 (Supabase Edge Function secret):
//      supabase secrets set VAPID_PUBLIC_KEY=<public key>
//      supabase secrets set VAPID_PRIVATE_KEY=<private key>
//      supabase secrets set VAPID_SUBJECT=mailto:admin@geek.app
//
// 4. Edge Function をデプロイ:
//      supabase functions deploy send-push
//
// 5. notifications テーブルの INSERT で send-push を起動するように
//    Database Webhook を設定 (Studio → Database → Webhooks)。
//    - URL: <project>.functions.supabase.co/send-push
//    - HTTP method: POST
//    - Table: notifications, Events: INSERT
// ============================================================

import { supabase } from '../supabase';

export type StoredPushSubscription = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
  user_agent: string;
  platform: 'web' | 'ios' | 'android';
  created_at: string;
};

// PushSubscription.toJSON() で得られる形 (web spec)
type PushSubscriptionJSON = {
  endpoint: string;
  keys?: { p256dh?: string; auth?: string };
};

function extractKeys(sub: PushSubscription): { endpoint: string; p256dh: string; auth: string } | null {
  const json = sub.toJSON() as PushSubscriptionJSON;
  const endpoint = json.endpoint ?? sub.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!endpoint || !p256dh || !auth) return null;
  return { endpoint, p256dh, auth };
}

// 同じ user_id + endpoint なら更新。新規ならインサート。
export async function pushSubscribe(subscription: PushSubscription): Promise<{ error: string | null }> {
  const keys = extractKeys(subscription);
  if (!keys) return { error: '購読情報の取得に失敗しました' };

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'ログインが必要です' };

  const ua =
    typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string'
      ? navigator.userAgent.slice(0, 500)
      : '';

  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        user_id: user.id,
        endpoint: keys.endpoint,
        p256dh: keys.p256dh,
        auth_key: keys.auth,
        user_agent: ua,
        platform: 'web' as const,
      },
      { onConflict: 'user_id,endpoint' },
    );

  if (error) {
    console.warn('[push] subscribe failed:', error.message);
    return { error: error.message };
  }
  return { error: null };
}

export async function pushUnsubscribe(endpoint: string): Promise<{ error: string | null }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'ログインが必要です' };

  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('user_id', user.id)
    .eq('endpoint', endpoint);

  if (error) {
    console.warn('[push] unsubscribe failed:', error.message);
    return { error: error.message };
  }
  return { error: null };
}

export async function getMyPushSubscriptions(): Promise<StoredPushSubscription[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    console.warn('[push] list failed:', error.message);
    return [];
  }
  return (data ?? []) as StoredPushSubscription[];
}

// ============================================================
// VAPID 公開鍵 (クライアントバンドル に inline されている)。
// 設定されていなければ空文字 — UI 側で disable する。
// ============================================================
export const VAPID_PUBLIC_KEY: string = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY ?? '';
export const isVapidConfigured = (): boolean => VAPID_PUBLIC_KEY.length > 0;

// base64url → Uint8Array (PushManager.subscribe の applicationServerKey に必要)
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  if (typeof atob !== 'function') {
    // SSR/Node などで atob が無いときは空配列で返す (UI 側でガード)
    return new Uint8Array(0);
  }
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}
