import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchNotifications, markAllRead, markRead as markReadApi } from '../lib/api/notifications';
import { fetchMyNotificationPreferences } from '../lib/api/notificationPreferences';
import { shouldShowInApp } from '../lib/utils/notificationFilter';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';
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

  // 通知設定 (アプリ内表示の ON/OFF) — settings/notifications.tsx と同じ prefs。
  const prefsQuery = useQuery({
    queryKey: ['notification-preferences', userId],
    queryFn: fetchMyNotificationPreferences,
    enabled: !!userId,
    staleTime: 5 * 60_000,
  });
  const prefs = prefsQuery.data ?? [];

  // アプリ内表示 OFF のカテゴリは一覧・未読数の両方から除外する (#20)。
  // prefs 未取得 / 未設定カテゴリは shouldShowInApp が default true を返す (fail-open)。
  const notifications = ((q.data ?? []) as Notification[]).filter((n) =>
    shouldShowInApp(n, prefs),
  );
  const unreadCount = notifications.filter((n) => !n.read).length;

  return {
    notifications,
    unreadCount,
    loading: q.isLoading,
    // ============================================================
    // markAllRead — 楽観 update + snapshot/revert
    // ============================================================
    // 改訂理由 (2026-05-28):
    //   旧版は server RTT 完了 (await markAllRead()) 後に setQueryData → UI 反映に
    //   数百 ms〜数秒のラグがあった。さらに失敗時の revert がないため、ネットワーク
    //   エラーで「既読化したつもりが未読のまま」という状態の食い違いが残っていた。
    //   pattern を useReactionToggle 等に合わせる:
    //     1) 即時 optimistic update (UI 反映 0ms)
    //     2) snapshot を保持
    //     3) server 失敗時は snapshot で revert + toast
    //     4) realtime UPDATE で server-truth 確定
    // ============================================================
    markAllRead: async () => {
      const prev = qc.getQueryData<Notification[]>(NOTIF_KEY);
      // 1) optimistic: 即時に全件 read=true 化
      qc.setQueryData<Notification[]>(NOTIF_KEY, (old) =>
        (old ?? []).map((n) => ({ ...n, read: true })),
      );
      try {
        await markAllRead();
      } catch (e) {
        // 2) revert
        if (prev !== undefined) qc.setQueryData<Notification[]>(NOTIF_KEY, prev);
        const msg = e instanceof Error ? e.message : '';
        useToastStore.getState().show(
          msg ? `既読化に失敗しました: ${msg}` : '既読化に失敗しました',
          'error',
        );
        throw e;
      }
    },
    // ============================================================
    // markRead — 単一通知の既読化 (タップ時)。optimistic + 静かに revert。
    // ============================================================
    // 失敗時は toast を出さない: タップは遷移を伴うので、軽微な既読同期失敗で
    // ユーザーの導線を邪魔しない (次回 fetch / realtime で server-truth に収束)。
    markRead: async (id: string) => {
      const prev = qc.getQueryData<Notification[]>(NOTIF_KEY);
      qc.setQueryData<Notification[]>(NOTIF_KEY, (old) =>
        (old ?? []).map((n) => (n.id === id ? { ...n, read: true } : n)),
      );
      try {
        await markReadApi(id);
      } catch {
        if (prev !== undefined) qc.setQueryData<Notification[]>(NOTIF_KEY, prev);
      }
    },
  };
}

// 通知バッジだけ欲しい場面 (TabBar 等) で軽量に未読数を取得
export function useUnreadCount(): number {
  const { unreadCount } = useNotifications();
  return unreadCount;
}
