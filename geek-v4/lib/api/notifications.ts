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
