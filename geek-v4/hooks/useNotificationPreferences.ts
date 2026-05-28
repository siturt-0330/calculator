// ============================================================
// hooks/useNotificationPreferences.ts
// ============================================================
// 通知 preference の取得 + 更新 (optimistic) hook。
//
// 設計:
//   - useNotificationPreferences(): React Query で 11 カテゴリ全 prefs を返す
//   - useUpdateNotificationPreference(): 単一カテゴリ × {push/inapp} の更新
//   - mutation 中は optimistic update — UI が即座に切り替わる
//   - error 時は snapshot から revert
// ============================================================

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';
import {
  fetchMyNotificationPreferences,
  updateNotificationPreference,
  type NotificationCategory,
  type NotificationPref,
} from '../lib/api/notificationPreferences';

const PREF_KEY = ['notification-preferences'] as const;

export function useNotificationPreferences() {
  const userId = useAuthStore((s) => s.user?.id);
  const q = useQuery({
    queryKey: PREF_KEY,
    queryFn: fetchMyNotificationPreferences,
    staleTime: 60_000,
    enabled: !!userId,
  });
  return {
    preferences: (q.data ?? []) as NotificationPref[],
    isLoading: q.isLoading,
    error: q.error,
  };
}

type UpdateVars = {
  category: NotificationCategory;
  patch: { push?: boolean; inapp?: boolean };
};

export function useUpdateNotificationPreference() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ category, patch }: UpdateVars) =>
      updateNotificationPreference(category, patch),

    // ============================================================
    // Optimistic update — UI を mutation 確定前に切り替える
    // ============================================================
    // 1. 進行中の query を cancel (race condition 防止)
    // 2. 現在の cache snapshot を保存
    // 3. cache を即時に更新 (UI 反映)
    // 4. context として snapshot を返す → onError で復帰可能
    // ============================================================
    onMutate: async ({ category, patch }) => {
      await qc.cancelQueries({ queryKey: PREF_KEY });
      const previous = qc.getQueryData<NotificationPref[]>(PREF_KEY) ?? [];

      const next: NotificationPref[] = (() => {
        const idx = previous.findIndex((p) => p.category === category);
        if (idx === -1) {
          // 該当 category が未取得 (fetch 前) — 新規追加 (default true)
          return [
            ...previous,
            {
              category,
              push: patch.push ?? true,
              inapp: patch.inapp ?? true,
            },
          ];
        }
        const target = previous[idx];
        if (!target) return previous;
        const updated: NotificationPref = {
          category: target.category,
          push: patch.push ?? target.push,
          inapp: patch.inapp ?? target.inapp,
        };
        const arr = previous.slice();
        arr[idx] = updated;
        return arr;
      })();

      qc.setQueryData<NotificationPref[]>(PREF_KEY, next);
      return { previous };
    },

    onError: (_err, _vars, ctx) => {
      // optimistic update を revert
      if (ctx?.previous) {
        qc.setQueryData<NotificationPref[]>(PREF_KEY, ctx.previous);
      }
    },

    onSettled: () => {
      // 最終的な真実をサーバーから取り直す
      void qc.invalidateQueries({ queryKey: PREF_KEY });
    },
  });
}
