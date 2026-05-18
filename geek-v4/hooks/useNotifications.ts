import { useEffect } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { fetchNotifications, markAllRead } from '@/lib/api/notifications';
import { useAuthStore } from '@/stores/authStore';
import type { Notification } from '@/types/models';

const NOTIF_KEY = ['notifications'];

// ============================================================
// Realtime subscription manager (singleton)
// ============================================================
// useNotifications() は TabBar / Feed / Mypage / Notifications 画面など
// 複数の場所から呼ばれる。各呼び出しごとに channel(`notifications:${userId}`)
// を作っていたが、Supabase Client は同名 channel を再利用するため、
// 2 回目以降の .on() 呼び出しが「subscribe 後の追加は不可」で全て失敗していた
// (コンソールに大量エラー → CPU 食い潰しでブラウザがハング)。
//
// 修正: subscribe はモジュールスコープで一度だけ実行する。複数の hook が同時に
//       useEffect を走らせても、すでに subscribe 済みなら no-op で返す。
// ============================================================

let activeChannel: ReturnType<typeof supabase.channel> | null = null;
let activeUserId: string | null = null;
let refCount = 0;

function attachRealtime(userId: string, qc: QueryClient) {
  if (activeUserId === userId && activeChannel) {
    refCount++;
    return;
  }
  // 別ユーザーへ切り替わった場合は前のチャンネルを破棄
  if (activeChannel) {
    void supabase.removeChannel(activeChannel);
    activeChannel = null;
    activeUserId = null;
  }
  activeUserId = userId;
  refCount = 1;
  activeChannel = supabase
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
}

function detachRealtime() {
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0 && activeChannel) {
    void supabase.removeChannel(activeChannel);
    activeChannel = null;
    activeUserId = null;
  }
}

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
    attachRealtime(userId, qc);
    return () => detachRealtime();
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
