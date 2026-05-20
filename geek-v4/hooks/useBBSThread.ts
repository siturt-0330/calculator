import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchReplies, createReply, fetchThread } from '../lib/api/bbs';
import { attachChannel } from '../lib/realtime';

export function useBBSThread(threadId: string) {
  const qc = useQueryClient();

  const { data: thread, error: threadError, isLoading: threadLoading } = useQuery({
    queryKey: ['bbs-thread', threadId],
    queryFn: () => fetchThread(threadId),
    staleTime: 60_000,
    retry: 1,
  });

  const { data, isLoading, isRefetching, refetch, error: repliesError } = useQuery({
    queryKey: ['bbs-replies', threadId],
    queryFn: () => fetchReplies(threadId),
    staleTime: 30_000,
    retry: 1,
  });

  const { mutateAsync: reply } = useMutation({
    mutationFn: (content: string) => createReply(threadId, content),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bbs-replies', threadId] });
      qc.invalidateQueries({ queryKey: ['bbs-thread', threadId] });
    },
  });

  // Realtime: 同じスレッドへの新着返信
  useEffect(() => {
    if (!threadId) return;
    return attachChannel(`bbs-thread:${threadId}`, (ch) =>
      ch.on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'bbs_replies', filter: `thread_id=eq.${threadId}` },
        () => {
          qc.invalidateQueries({ queryKey: ['bbs-replies', threadId] });
          qc.invalidateQueries({ queryKey: ['bbs-thread', threadId] });
        },
      ),
    );
  }, [threadId, qc]);

  return {
    thread,
    replies: data ?? [],
    loading: isLoading || threadLoading,
    refreshing: isRefetching,
    refresh: refetch,
    reply,
    error: threadError || repliesError,
  };
}
