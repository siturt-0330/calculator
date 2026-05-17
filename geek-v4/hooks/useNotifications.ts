import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { fetchNotifications, markAllRead } from '@/lib/api/notifications';
import { useAuthStore } from '@/stores/authStore';
import type { Notification } from '@/types/models';

const NOTIF_KEY = ['notifications'];

export function useNotifications() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);

  const q = useQuery({
    queryKey: NOTIF_KEY,
    queryFn: fetchNotifications,
    staleTime: 30_000,
    enabled: !!userId,
  });

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => {
          const newRow = payload.new as Notification;
          qc.setQueryData<Notification[]>(NOTIF_KEY, (old) => [newRow, ...(old ?? [])]);
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        () => qc.invalidateQueries({ queryKey: NOTIF_KEY }),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, qc]);

  const notifications = (q.data ?? []) as Notification[];
  const unreadCount = notifications.filter((n) => !n.read).length;

  return {
    notifications,
    unreadCount,
    loading: q.isLoading,
    markAllRead: async () => {
      await markAllRead();
      qc.setQueryData<Notification[]>(NOTIF_KEY, (old) =>
        (old ?? []).map((n) => ({ ...n, read: true })),
      );
    },
  };
}

// 通知バッジだけ欲しい場面 (TabBar 等) で軽量に未読数を取得
export function useUnreadCount(): number {
  const { unreadCount } = useNotifications();
  return unreadCount;
}
