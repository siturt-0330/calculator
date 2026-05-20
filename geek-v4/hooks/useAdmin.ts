import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { attachChannel } from '../lib/realtime';
import {
  fetchIsAdmin,
  fetchAllFeedback,
  updateFeedback,
  type FeedbackKind,
  type FeedbackRow,
  type AdminFeedbackRow,
} from '../lib/api/feedback';
import { useAuthStore } from '../stores/authStore';

export function useIsAdmin(): boolean {
  const userId = useAuthStore((s) => s.user?.id);
  const { data } = useQuery({
    queryKey: ['is-admin', userId],
    queryFn: fetchIsAdmin,
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
  return !!data;
}

export function useAllFeedback(filter?: { status?: FeedbackRow['status'] | 'all'; kind?: FeedbackKind | 'all' }) {
  const qc = useQueryClient();
  const filterKey = `${filter?.status ?? 'all'}:${filter?.kind ?? 'all'}`;

  const q = useQuery({
    queryKey: ['feedback-admin', filterKey],
    queryFn: () => fetchAllFeedback(filter),
    staleTime: 30 * 1000,
  });

  useEffect(() => {
    return attachChannel('feedback-admin-live', (ch) =>
      ch.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'app_feedback' },
        () => qc.invalidateQueries({ queryKey: ['feedback-admin'] }),
      ),
    );
  }, [qc]);

  return { feedback: (q.data ?? []) as AdminFeedbackRow[], isLoading: q.isLoading };
}

export function useUpdateFeedback() {
  const qc = useQueryClient();
  const { mutateAsync } = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: { status?: FeedbackRow['status']; admin_notes?: string } }) =>
      updateFeedback(id, updates),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feedback-admin'] }),
  });
  return mutateAsync;
}
