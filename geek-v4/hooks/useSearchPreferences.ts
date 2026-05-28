// ============================================================
// hooks/useSearchPreferences.ts
// ------------------------------------------------------------
// 検索パーソナライズ設定の取得 + 更新を React Query で扱う hook。
//
// 設計:
//   - useSearchPreferences(): getSearchPreferences を query で wrap。
//     未ログインでも DEFAULT_PREFERENCES を即座に返す (enabled=false)。
//   - useUpdateSearchPreferences(): 部分更新の mutation。
//     optimistic update + onError で snapshot 復帰 + onSettled で invalidate。
//   - useClearSearchHistory(): clear_search_history RPC を呼ぶだけの mutation。
//
// queryKey は ['search-preferences', userId]。userId が無い場合は null を含めて
// 「ログアウト時にキャッシュを汚染しない」ようにする。
// ============================================================

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';
import {
  DEFAULT_PREFERENCES,
  clearSearchHistory,
  getSearchPreferences,
  updateSearchPreferences,
  type SearchPreferences,
} from '../lib/api/searchPreferences';

const KEY_BASE = 'search-preferences' as const;

const keyOf = (userId: string | undefined): readonly unknown[] =>
  [KEY_BASE, userId ?? null] as const;

// ----------------------------------------------------------------
// Read
// ----------------------------------------------------------------

export type UseSearchPreferencesResult = {
  preferences: SearchPreferences;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
};

/**
 * 自分の検索 preferences を取得する hook。
 *
 * - 未ログイン時は query を fire せず、即 DEFAULT_PREFERENCES を返す。
 * - 取得失敗 (lib 側で swallow) も DEFAULT_PREFERENCES が data に入るので
 *   UI 側で undefined を考慮する必要はない。
 */
export function useSearchPreferences(): UseSearchPreferencesResult {
  const userId = useAuthStore((s) => s.user?.id);
  const q = useQuery<SearchPreferences>({
    queryKey: keyOf(userId),
    queryFn: getSearchPreferences,
    staleTime: 60_000,
    gcTime: 1000 * 60 * 30,
    enabled: !!userId,
  });
  return {
    preferences: q.data ?? DEFAULT_PREFERENCES,
    isLoading: q.isLoading,
    isFetching: q.isFetching,
    error: q.error,
  };
}

// ----------------------------------------------------------------
// Update
// ----------------------------------------------------------------

/**
 * 検索 preferences の部分更新 mutation (optimistic)。
 *
 * mutationFn は Partial<SearchPreferences> を 1 引数で受ける。
 * onMutate で cache を即時更新 → onError で revert → onSettled で
 * server の真実を refetch する標準パターン。
 */
export function useUpdateSearchPreferences() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);
  const key = keyOf(userId);

  return useMutation<void, unknown, Partial<SearchPreferences>, { previous: SearchPreferences | undefined }>({
    mutationFn: (patch) => updateSearchPreferences(patch),

    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<SearchPreferences>(key);
      const base = previous ?? DEFAULT_PREFERENCES;
      const next: SearchPreferences = { ...base, ...patch };
      qc.setQueryData<SearchPreferences>(key, next);
      return { previous };
    },

    onError: (_err, _patch, ctx) => {
      if (ctx?.previous) {
        qc.setQueryData<SearchPreferences>(key, ctx.previous);
      }
    },

    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key });
    },
  });
}

// ----------------------------------------------------------------
// Clear history
// ----------------------------------------------------------------

/**
 * サーバー側検索履歴の一掃 mutation。
 *
 * 副作用は server-side のみ。クライアント側 (autocomplete / store) は
 * UI 側で別途 clearAll を呼ぶ想定 (useSearchHistory.clearAll)。
 */
export function useClearSearchHistory() {
  return useMutation<void, unknown, void>({
    mutationFn: () => clearSearchHistory(),
  });
}
