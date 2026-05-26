import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { attachChannel } from '../lib/realtime';
import { fetchPolls, vote as voteApi, type Poll } from '../lib/api/polls';

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
    // server-side filter で fanout を抑える
    // poll_id が空 (まだ poll データを fetch してない初回 render) の時は subscribe しない
    if (myPollIds.size === 0) return;
    const serverPollIds = [...myPollIds].slice(0, 30);
    const serverPostIds = postIds.slice(0, 30);

    // ★ CLAUDE.md § 5.3 / § 14: 1 channel に異なる table を chain しない。
    //   poll_votes / poll_options / polls を別 channel に分離。現状全テーブル
    //   publication 登録済 (0013) で動作しているが、将来 1 つでも漏れたら
    //   channel 全死する地雷を防ぐ。
    const invalidate = () => qc.invalidateQueries({ queryKey: [KEY_PREFIX, sortedKey] });
    const detachVotes = attachChannel(`poll-votes:${sortedKey.slice(0, 64)}`, (ch) =>
      ch.on('postgres_changes', {
        event: '*', schema: 'public', table: 'poll_votes',
        filter: `poll_id=in.(${serverPollIds.join(',')})`,
      }, (payload) => {
        const row = (payload.new ?? payload.old) as { poll_id?: string } | null;
        if (row?.poll_id && myPollIds.has(row.poll_id)) invalidate();
      }),
    );
    const detachOptions = attachChannel(`poll-options:${sortedKey.slice(0, 64)}`, (ch) =>
      ch.on('postgres_changes', {
        event: '*', schema: 'public', table: 'poll_options',
        filter: `poll_id=in.(${serverPollIds.join(',')})`,
      }, (payload) => {
        const row = (payload.new ?? payload.old) as { poll_id?: string } | null;
        if (row?.poll_id && myPollIds.has(row.poll_id)) invalidate();
      }),
    );
    const detachPolls = attachChannel(`polls:${sortedKey.slice(0, 64)}`, (ch) =>
      ch.on('postgres_changes', {
        event: '*', schema: 'public', table: 'polls',
        filter: `post_id=in.(${serverPostIds.join(',')})`,
      }, (payload) => {
        const row = (payload.new ?? payload.old) as { post_id?: string } | null;
        if (row?.post_id && myPostIds.has(row.post_id)) invalidate();
      }),
    );
    return () => { detachVotes(); detachOptions(); detachPolls(); };
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
