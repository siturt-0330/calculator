import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { attachChannel } from '../lib/realtime';
import { useAuthStore } from '../stores/authStore';
import {
  fetchSavedSearches, createSavedSearch, updateSavedSearch, deleteSavedSearch, type SavedSearch,
} from '../lib/api/savedSearches';

const KEY = ['saved-searches'];

export function useSavedSearches() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);
  const q = useQuery({
    queryKey: KEY,
    queryFn: fetchSavedSearches,
    staleTime: 60_000,
  });
  useEffect(() => {
    // 自分の saved_searches だけ realtime。他人の保存検索を受け取る必要は一切なし。
    if (!userId) return;
    return attachChannel(`saved-searches-watch:${userId}`, (ch) =>
      ch.on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'saved_searches',
        filter: `user_id=eq.${userId}`,
      },
        () => qc.invalidateQueries({ queryKey: KEY })),
    );
  }, [qc, userId]);
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
