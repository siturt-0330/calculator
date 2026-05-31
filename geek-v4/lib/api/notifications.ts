import { supabase } from '../supabase';
import type { Notification } from '../../types/models';

export async function fetchNotifications(): Promise<Notification[]> {
  // data (jsonb) は type 別の追加メタを格納する。例えば 'join_request' は
  // { community_id, applicant_user_id, ... } を持ち、タップ時の遷移先解決に使う。
  // 0101 migration 以降は trigger でこの列を必ず埋めているので SELECT から外せない。
  const { data, error } = await supabase
    .from('notifications')
    .select('id, type, tag_name, message, read, data, created_at')
    .order('created_at', { ascending: false })
    .limit(50);
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
