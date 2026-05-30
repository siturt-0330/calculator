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

// ============================================================
// Native (iOS / Android) push token registration
// ============================================================
// 旧版は app/onboarding/notifications.tsx で `requestPermissionsAsync()` を
// 呼ぶだけで token を取得・保存していなかった。結果として:
//   - permission は granted されるが
//   - push_subscriptions テーブルに native row が一切作られず
//   - send-push Edge Function (Expo Push API 経由) が宛先を持てない
// → native ユーザーには通知が永遠に届かないバグ。
//
// この関数を onboarding と settings/notifications から呼ぶことで:
//   1. Notifications.getExpoPushTokenAsync() で ExponentPushToken[...] 取得
//   2. push_subscriptions に platform='ios'/'android', endpoint=token として upsert
//      (p256dh / auth_key は Web Push 用の NOT NULL カラムなので空文字を入れる)
//
// 将来的に migration で p256dh / auth_key を NULL 可にして、あるいは
// expo_push_token カラムを別に切ると schema が綺麗になる。今は schema 互換のみ
// 守って quick fix。
// ============================================================
export async function registerNativePushToken(): Promise<{ ok: boolean; error?: string }> {
  // Platform は呼び出し側 (RN only) で限定する想定だが安全のためここでもガード。
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { Platform } = require('react-native') as typeof import('react-native');
  if (Platform.OS === 'web') return { ok: false, error: 'web は別経路 (pushSubscribe) を使う' };

  // expo-notifications を lazy require: web bundle に native 専用モジュール
  // を含めないため (lib/api/account.ts と同じパターン)。
  let Notifications: typeof import('expo-notifications');
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    Notifications = require('expo-notifications') as typeof import('expo-notifications');
  } catch (e) {
    return { ok: false, error: `expo-notifications load failed: ${String(e)}` };
  }

  // EAS Build / production では projectId が必要。getExpoPushTokenAsync 内部で
  // Constants.expoConfig.extra.eas.projectId が読まれる。
  let tokenResp: { data: string } | null = null;
  try {
    tokenResp = await Notifications.getExpoPushTokenAsync();
  } catch (e) {
    return { ok: false, error: `getExpoPushTokenAsync failed: ${String(e)}` };
  }
  const token = tokenResp?.data;
  if (!token) return { ok: false, error: 'push token が空でした' };

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'ログインが必要です' };

  const platform: 'ios' | 'android' = Platform.OS === 'ios' ? 'ios' : 'android';
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        user_id: user.id,
        endpoint: token,
        // Web Push 用 NOT NULL カラム互換 — native では使用しないので空文字を埋める
        p256dh: '',
        auth_key: '',
        user_agent: `expo-${platform}`,
        platform,
      },
      { onConflict: 'user_id,endpoint' },
    );

  if (error) {
    console.warn('[push] native register failed:', error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

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
