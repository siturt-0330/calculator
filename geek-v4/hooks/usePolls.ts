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
    // 現在表示中の poll_id 集合 — payload を見て自分のリスト内のだけ invalidate
    const polls = (q.data ?? {}) as Record<string, Poll>;
    const myPollIds = new Set(Object.values(polls).map((p) => p.id));
    const myPostIds = new Set(postIds);

    return attachChannel(`polls:${sortedKey.slice(0, 64)}`, (ch) =>
      ch.on('postgres_changes', { event: '*', schema: 'public', table: 'poll_votes' }, (payload) => {
        const row = (payload.new ?? payload.old) as { poll_id?: string } | null;
        if (row?.poll_id && myPollIds.has(row.poll_id)) {
          qc.invalidateQueries({ queryKey: [KEY_PREFIX, sortedKey] });
        }
      }).on('postgres_changes', { event: '*', schema: 'public', table: 'poll_options' }, (payload) => {
        const row = (payload.new ?? payload.old) as { poll_id?: string } | null;
        if (row?.poll_id && myPollIds.has(row.poll_id)) {
          qc.invalidateQueries({ queryKey: [KEY_PREFIX, sortedKey] });
        }
      }).on('postgres_changes', { event: '*', schema: 'public', table: 'polls' }, (payload) => {
        const row = (payload.new ?? payload.old) as { post_id?: string } | null;
        if (row?.post_id && myPostIds.has(row.post_id)) {
          qc.invalidateQueries({ queryKey: [KEY_PREFIX, sortedKey] });
        }
      }),
    );
  }, [sortedKey, qc, q.data, postIds]);

  return { polls: (q.data ?? {}) as Record<string, Poll>, isLoading: q.isLoading };
}

export function usePollVote() {
  const qc = useQueryClient();
  const { mutateAsync } = useMutation({
    mutationFn: ({ pollId, optionId, multiSelect }: { pollId: string; optionId: string; multiSelect: boolean }) =>
      voteApi(pollId, optionId, multiSelect),
    onSettled: () => qc.invalidateQueries({ queryKey: [KEY_PREFIX] }),
  });
  return {
    vote: (pollId: string, optionId: string, multiSelect: boolean) =>
      mutateAsync({ pollId, optionId, multiSelect }).catch((e) => {
        // ログだけ残して silent swallow しない (UI は楽観更新済 → 失敗時は invalidate で revert)
        console.warn('[usePollVote] vote failed:', e);
      }),
  };
}
