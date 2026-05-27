import { useEffect, useMemo } from 'react';
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

  // q.data から poll_id 集合を文字列キー化 — 中身 (id の集合) が同じ間は
  // 参照変化 (refetch でも内容不変) で channel を re-attach しない.
  // これを deps にしないと invalidate→refetch→q.data 新参照→effect 再実行
  // → 3 channel が detach/attach するループで Supabase pool が枯渇する.
  const pollIdsKey = useMemo(() => {
    const polls = (q.data ?? {}) as Record<string, Poll>;
    return Object.values(polls).map((p) => p.id).sort().join(',');
  }, [q.data]);

  useEffect(() => {
    if (!sortedKey) return;
    if (!pollIdsKey) return;
    // 現在表示中の poll_id 集合 — payload を見て自分のリスト内のだけ invalidate
    const myPollIds = new Set(pollIdsKey.split(','));
    const myPostIds = new Set(postIds);
    // server-side filter で fanout を抑える
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
    // ★ postIds は配列参照で毎 render 変わるため deps から外す (sortedKey に
    //   中身は含意済). q.data も参照変化を pollIdsKey に置換して churn を防ぐ.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedKey, pollIdsKey, qc]);

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
