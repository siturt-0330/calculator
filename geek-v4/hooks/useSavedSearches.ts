import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchSavedSearches, createSavedSearch, updateSavedSearch, deleteSavedSearch, type SavedSearch,
} from '../lib/api/savedSearches';

const KEY = ['saved-searches'];

// ============================================================
// useSavedSearches
// ============================================================
// 旧構成: 個別 channel `saved-searches-watch:userId` を attach。
// 新構成 (Audit E#5): hooks/useUserChannel.ts の 1 channel に集約 (filter=user_id)。
// ============================================================
export function useSavedSearches() {
  const q = useQuery({
    queryKey: KEY,
    queryFn: fetchSavedSearches,
    staleTime: 60_000,
  });
  return { searches: (q.data ?? []) as SavedSearch[], isLoading: q.isLoading };
}

export function useCreateSavedSearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ query, label, notify }: { query: string; label?: string; notify?: boolean }) =>
      createSavedSearch(query, label, notify),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteSavedSearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteSavedSearch,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateSavedSearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<SavedSearch> }) =>
      updateSavedSearch(id, updates),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
