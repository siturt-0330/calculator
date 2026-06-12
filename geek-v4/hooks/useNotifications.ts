import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchNotifications,
  markAllRead,
  markRead as markReadApi,
  markReadMany as markReadManyApi,
  deleteNotifications as deleteNotificationsApi,
} from '../lib/api/notifications';
import { fetchMyNotificationPreferences } from '../lib/api/notificationPreferences';
import { shouldShowInApp } from '../lib/utils/notificationFilter';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';
import type { Notification } from '../types/models';

// ★ userId スコープ付き通知 key の factory。固定 ['notifications'] だと signOut が
//   QueryClient を clear せず persist(2h) も残るため、別ユーザーでログインした瞬間
//   (enabled が true→refetch までの間 / realtime prepend / 楽観 markRead) に前ユーザーの
//   通知が一瞬混ざりうる。userId を key に含めれば別ユーザーは別 cache entry になり防げる。
//   useUserChannel.ts / feed.tsx の prefetch とも同形 (['notifications', userId]) に揃える。
const notifKey = (userId: string | undefined) => ['notifications', userId ?? null] as const;

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
  const NOTIF_KEY = notifKey(userId);

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

  // ============================================================
  // markAllRead — 楽観 update + snapshot/revert
  // ============================================================
  // useCallback で参照を安定化 (毎 render に新関数を作らない)。
  // NOTIF_KEY は userId から派生し、userId が変わる (= ユーザー切替) まで stable。
  // ============================================================
  const handleMarkAllRead = useCallback(async () => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, NOTIF_KEY]);

  // ============================================================
  // markRead — 単一通知の既読化 (タップ時)。optimistic + 静かに revert。
  // ============================================================
  // 失敗時は toast を出さない: タップは遷移を伴うので、軽微な既読同期失敗で
  // ユーザーの導線を邪魔しない (次回 fetch / realtime で server-truth に収束)。
  const handleMarkRead = useCallback(async (id: string) => {
    const prev = qc.getQueryData<Notification[]>(NOTIF_KEY);
    qc.setQueryData<Notification[]>(NOTIF_KEY, (old) =>
      (old ?? []).map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
    try {
      await markReadApi(id);
    } catch {
      if (prev !== undefined) qc.setQueryData<Notification[]>(NOTIF_KEY, prev);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, NOTIF_KEY]);

  // ============================================================
  // markReadMany — 集約行 (IG/X 流) のタップ時にグループ内の未読を一括既読化。
  // markRead と同じ optimistic + 静かに revert 方針。
  // ============================================================
  const handleMarkReadMany = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const prev = qc.getQueryData<Notification[]>(NOTIF_KEY);
    qc.setQueryData<Notification[]>(NOTIF_KEY, (old) =>
      (old ?? []).map((n) => (idSet.has(n.id) ? { ...n, read: true } : n)),
    );
    try {
      await markReadManyApi(ids);
    } catch {
      if (prev !== undefined) qc.setQueryData<Notification[]>(NOTIF_KEY, prev);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, NOTIF_KEY]);

  // ============================================================
  // deleteMany — YouTube の「この通知を非表示」相当。楽観削除 + 失敗時 revert。
  // 削除は破壊的なので失敗 toast を出す (markRead と違い気づけないと不誠実)。
  // ============================================================
  const handleDeleteMany = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const prev = qc.getQueryData<Notification[]>(NOTIF_KEY);
    qc.setQueryData<Notification[]>(NOTIF_KEY, (old) =>
      (old ?? []).filter((n) => !idSet.has(n.id)),
    );
    try {
      await deleteNotificationsApi(ids);
    } catch (e) {
      if (prev !== undefined) qc.setQueryData<Notification[]>(NOTIF_KEY, prev);
      const msg = e instanceof Error ? e.message : '';
      useToastStore.getState().show(
        msg ? `通知の削除に失敗しました: ${msg}` : '通知の削除に失敗しました',
        'error',
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, NOTIF_KEY]);

  return {
    notifications,
    unreadCount,
    loading: q.isLoading,
    markAllRead: handleMarkAllRead,
    markRead: handleMarkRead,
    markReadMany: handleMarkReadMany,
    deleteMany: handleDeleteMany,
  };
}

// 通知バッジだけ欲しい場面 (TabBar / LeftSidebar 等) で軽量に未読数を取得。
// ★ useNotifications() を丸呼びすると notifications 配列全体を購読してしまい、
//    realtime INSERT/UPDATE や単一既読の楽観 update など「未読数が変わらない」変更でも
//    購読 component が再 render する。ここでは useQuery の select で最終的な未読「件数」
//    (number) まで絞り込み、RQ observer の追跡対象を数値にする → 件数が変わったときだけ
//    再 render する (配列の参照変化には追従しない)。
export function useUnreadCount(): number {
  const userId = useAuthStore((s) => s.user?.id);

  // prefs は低頻度更新。select 内のフィルタに使うため別購読する。
  const prefsQuery = useQuery({
    queryKey: ['notification-preferences', userId],
    queryFn: fetchMyNotificationPreferences,
    enabled: !!userId,
    staleTime: 5 * 60_000,
  });
  const prefs = prefsQuery.data ?? [];

  const { data: count } = useQuery({
    queryKey: notifKey(userId),
    queryFn: fetchNotifications,
    staleTime: 60_000,
    enabled: !!userId,
    // ★ narrow selector: 配列ではなく prefs フィルタ後の未読「件数」を返す。
    //    出力が number なので RQ は値が変わったときだけ購読側を再 render する。
    select: (rows: Notification[]) =>
      rows.filter((n) => shouldShowInApp(n, prefs) && !n.read).length,
  });

  return count ?? 0;
}
