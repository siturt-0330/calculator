import { supabase } from '../supabase';
import { withApiTimeout } from '../withApiTimeout';
import type { Notification } from '../../types/models';

export async function fetchNotifications(): Promise<Notification[]> {
  // data (jsonb) は type 別の追加メタを格納する。例えば 'join_request' は
  // { community_id, applicant_user_id, ... } を持ち、タップ時の遷移先解決に使う。
  // 0101 migration 以降は trigger でこの列を必ず埋めているので SELECT から外せない。
  const { data, error } = await withApiTimeout(
    supabase
      .from('notifications')
      .select('id, type, tag_name, message, read, data, created_at')
      .order('created_at', { ascending: false })
      .limit(50),
    'notifications.fetch',
    6000,
  );
  if (error) throw error;
  return (data ?? []) as Notification[];
}

export async function markAllRead(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from('notifications')
    .update({ read: true })
    .eq('user_id', user.id);
}

// 単一通知だけ既読化 (タップ時)。user_id も条件に入れて他人の行を触れないようにする
// (RLS でも担保されているが defense-in-depth)。
export async function markRead(id: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from('notifications')
    .update({ read: true })
    .eq('id', id)
    .eq('user_id', user.id);
}

// 複数通知の一括既読化 — 集約行 (IG/X 流の「いいねが N 件」) のタップ時に
// グループ内の未読をまとめて既読化する (2026-06-12)。
export async function markReadMany(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from('notifications')
    .update({ read: true })
    .in('id', ids.slice(0, 100))
    .eq('user_id', user.id);
}

// 通知の削除 — YouTube の「この通知を非表示」相当 (行ごとの「…」メニューから)。
// 集約行は構成通知をまとめて削除する。RLS: notifications_own (FOR ALL) +
// 0084 notifications_delete_own が本人行のみに制限。
export async function deleteNotifications(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from('notifications')
    .delete()
    .in('id', ids.slice(0, 100))
    .eq('user_id', user.id);
}

// ============================================================
// 発信源コミュニティのアイコン (YouTube のチャンネルアイコン相当)
// ------------------------------------------------------------
// data.community_id を持つ通知 (community_post / join_request / mod_action)
// の発信元コミュニティを 1 query (IN) でまとめて引く。
// ============================================================
export type NotificationCommunityIcon = {
  id: string;
  name: string;
  icon_emoji: string | null;
  icon_url: string | null;
};

export async function fetchNotificationCommunityIcons(
  communityIds: string[],
): Promise<NotificationCommunityIcon[]> {
  if (communityIds.length === 0) return [];
  const { data, error } = await withApiTimeout(
    supabase
      .from('communities')
      .select('id, name, icon_emoji, icon_url')
      .in('id', communityIds.slice(0, 50)),
    'notifications.communityIcons',
    6000,
  );
  if (error) throw error;
  return (data ?? []) as NotificationCommunityIcon[];
}

// ============================================================
// 通知行の投稿プレビュー (IG/X 流: どの投稿への反応か一目で分かる)
// ------------------------------------------------------------
// 通知 data.post_id の投稿を 1 query (IN) でまとめて引き、本文先頭と
// サムネ URL を返す。RLS が可視性を裁くので、削除済み/非公開の投稿は
// 結果に現れない (= 行はプレビュー無しで表示される)。
// ============================================================
export type NotificationPostPreview = {
  id: string;
  content: string | null;
  thumb: string | null;
};

export async function fetchNotificationPostPreviews(
  postIds: string[],
): Promise<NotificationPostPreview[]> {
  if (postIds.length === 0) return [];
  const { data, error } = await withApiTimeout(
    supabase
      .from('posts')
      .select('id, content, media_urls')
      .in('id', postIds.slice(0, 50)),
    'notifications.postPreviews',
    6000,
  );
  if (error) throw error;
  return (data ?? []).map((p) => {
    const media = (p as { media_urls?: unknown }).media_urls;
    const first = Array.isArray(media) && typeof media[0] === 'string' ? media[0] : null;
    return {
      id: (p as { id: string }).id,
      content: ((p as { content?: string | null }).content ?? null) || null,
      thumb: first,
    };
  });
}
