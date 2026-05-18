import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
  fetchSavedSearches, createSavedSearch, updateSavedSearch, deleteSavedSearch, type SavedSearch,
} from '@/lib/api/savedSearches';

const KEY = ['saved-searches'];

export function useSavedSearches() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: KEY,
    queryFn: fetchSavedSearches,
    staleTime: 60_000,
  });
  useEffect(() => {
    const channel = supabase
      .channel('saved-searches-watch')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'saved_searches' },
        () => qc.invalidateQueries({ queryKey: KEY }))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);
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
