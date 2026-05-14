import { supabase } from '@/lib/supabase';
import type { Notification } from '@/types/models';

export async function fetchNotifications(): Promise<Notification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, type, tag_name, message, read, created_at')
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
