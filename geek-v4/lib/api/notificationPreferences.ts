// ============================================================
// lib/api/notificationPreferences.ts
// ============================================================
// 通知 preference の細分化 (migration 0070)。
//
// 11 カテゴリ × {push, inapp} の 2 軸トグル。サーバー側 (RPC) で
// 未設定カテゴリは default true で埋められて返ってくるので、クライアント
// 側は merge ロジックを書かなくて良い。
//
// 注意: 既存 useNotifications hook は notifications テーブルを直接 SELECT
// しているので、本 API では「ユーザーの設定だけ」を扱う。フィルタリング
// 自体は lib/utils/notificationFilter.ts が担う。
// ============================================================

import { supabase } from '../supabase';
import { withApiTimeout } from '../withApiTimeout';

export type NotificationCategory =
  | 'like'
  | 'comment'
  | 'reply'
  | 'mention'
  | 'follow'
  | 'friend_request'
  | 'friend_accept'
  | 'official_post'
  | 'event'
  | 'mod_action'
  | 'system'
  // コミュニティ新着投稿 (YouTube のチャンネル新着通知相当・migration 0149)
  | 'community_post';

export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = [
  'like',
  'comment',
  'reply',
  'mention',
  'follow',
  'friend_request',
  'friend_accept',
  'official_post',
  'event',
  'mod_action',
  'system',
  'community_post',
] as const;

export type NotificationPref = {
  category: NotificationCategory;
  push: boolean;
  inapp: boolean;
};

/**
 * 自分の通知 preference 全 11 カテゴリ分を取得する。
 * RPC が未設定行を default true で埋めて返すので、クライアント側で
 * 不足カテゴリを補完する必要はない。
 */
export async function fetchMyNotificationPreferences(): Promise<NotificationPref[]> {
  const { data, error } = await withApiTimeout(
    supabase.rpc('get_notification_preferences'),
    'notificationPreferences.fetch',
    8000,
  );
  if (error) throw error;
  const rows = (data ?? []) as Array<{ category: string; push: boolean; inapp: boolean }>;
  // RPC からは全 11 カテゴリが返るが、型を絞り込んで返す
  return rows
    .filter((r): r is NotificationPref =>
      (NOTIFICATION_CATEGORIES as readonly string[]).includes(r.category),
    )
    .map((r) => ({
      category: r.category as NotificationCategory,
      push: r.push,
      inapp: r.inapp,
    }));
}

/**
 * 単一カテゴリの preference を upsert で更新する。
 *
 * patch は { push?, inapp? } の部分更新。push / inapp のうち指定された側
 * だけが書き換わる。未指定側は既存値を維持する (== 行が存在しない場合は default true)。
 */
export async function updateNotificationPreference(
  category: NotificationCategory,
  patch: { push?: boolean; inapp?: boolean },
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // 既存行を先に取得して merge 後に upsert する。upsert だけだと未指定
  // フィールドが default で上書きされてしまうため。
  // (1 RTT 追加するが、preference 更新は頻度が低いのでコスト無視できる)
  const { data: existing } = await supabase
    .from('notification_preferences')
    .select('push, inapp')
    .eq('user_id', user.id)
    .eq('category', category)
    .maybeSingle();

  const merged = {
    user_id: user.id,
    category,
    push: patch.push ?? existing?.push ?? true,
    inapp: patch.inapp ?? existing?.inapp ?? true,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('notification_preferences')
    .upsert(merged, { onConflict: 'user_id,category' });

  if (error) throw error;
}
