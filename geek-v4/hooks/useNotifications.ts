import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchNotifications, markAllRead } from '../lib/api/notifications';
import { useAuthStore } from '../stores/authStore';
import type { Notification } from '../types/models';

const NOTIF_KEY = ['notifications'];

// ============================================================
// useNotifications — 通知 cache + 既読 mutation
// ============================================================
// 旧構成 (Audit E#3 = parallel singleton):
//   このファイルが `supabase.channel('notifications:${userId}').on(...).subscribe()`
//   を module-scope で持ち、複数呼び出しから refCount で共有していた。
//   attachChannel singleton と完全に独立した「2 つ目の channel manager」が存在し、
//   MAX_CONCURRENT_CHANNELS の集計から漏れる ghost channel になっていた。
//
// 新構成 (Audit E#3 + E#5 対策, 2026-05-28):
//   notifications の realtime は `hooks/useUserChannel.ts` の 1 user-wide channel
//   (`user:${userId}`) の `.on(notifications, ...)` で受信し、cache を直接更新する。
//   このファイルは React Query のみ管理。
//   useUserChannel() は app/_layout.tsx の RealtimeRoot で 1 度だけ mount される。
// ============================================================

export function useNotifications() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);

  const q = useQuery({
    queryKey: NOTIF_KEY,
    queryFn: fetchNotifications,
    // realtime INSERT/UPDATE で随時 cache が更新されるため background poll は最低限。
    // 60s = 取りこぼし時の safety-net (tab 非 focus 等で realtime が落ちた場合)。
    staleTime: 60_000,
    enabled: !!userId,
  });

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
