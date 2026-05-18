import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { attachChannel } from '@/lib/realtime';
import { fetchPolls, vote as voteApi, type Poll } from '@/lib/api/polls';

const KEY_PREFIX = 'polls';

export function usePolls(postIds: string[]) {
  const qc = useQueryClient();
  const sortedKey = postIds.slice().sort().join(',');

  const q = useQuery({
    queryKey: [KEY_PREFIX, sortedKey],
    queryFn: () => fetchPolls(postIds),
    enabled: postIds.length > 0,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!sortedKey) return;
    return attachChannel(`polls:${sortedKey.slice(0, 64)}`, (ch) =>
      ch.on('postgres_changes', { event: '*', schema: 'public', table: 'poll_votes' }, () => {
        qc.invalidateQueries({ queryKey: [KEY_PREFIX] });
      }).on('postgres_changes', { event: '*', schema: 'public', table: 'poll_options' }, () => {
        qc.invalidateQueries({ queryKey: [KEY_PREFIX] });
      }),
    );
  }, [sortedKey, qc]);

  return { polls: (q.data ?? {}) as Record<string, Poll>, isLoading: q.isLoading };
}

export function usePollVote() {
  const qc = useQueryClient();
  const { mutateAsync } = useMutation({
    mutationFn: ({ pollId, optionId, multiSelect }: { pollId: string; optionId: string; multiSelect: boolean }) =>
      voteApi(pollId, optionId, multiSelect),
    onSettled: () => qc.invalidateQueries({ queryKey: [KEY_PREFIX] }),
  });
  return { vote: (pollId: string, optionId: string, multiSelect: boolean) =>
    mutateAsync({ pollId, optionId, multiSelect }).catch(() => {}),
  };
}
