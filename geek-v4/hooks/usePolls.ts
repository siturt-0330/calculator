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

    // ★ Audit E#5 (2026-05-28):
    //   旧版は poll_votes / poll_options / polls を別 channel に分離していた (3 channel)。
    //   全 3 テーブルとも publication 登録済 (migration 0013) で確認済のため、
    //   CLAUDE.md § 5.3 の「publication 未登録 table が混ざると CHANNEL_ERROR
    //   cascade」リスクが無く、1 channel + 3 `.on()` に集約しても安全。
    //   feed 描画時の同時 channel 数を 14 → 5-7 に絞るための統合 (3 → 1)。
    //   将来 poll 系に publication 未登録 table を追加するなら、その際に分離する。
    const invalidate = () => qc.invalidateQueries({ queryKey: [KEY_PREFIX, sortedKey] });
    const detach = attachChannel(`polls-bundle:${sortedKey.slice(0, 64)}`, (ch) =>
      ch
        .on('postgres_changes', {
          event: '*', schema: 'public', table: 'poll_votes',
          filter: `poll_id=in.(${serverPollIds.join(',')})`,
        }, (payload) => {
          const row = (payload.new ?? payload.old) as { poll_id?: string } | null;
          if (row?.poll_id && myPollIds.has(row.poll_id)) invalidate();
        })
        .on('postgres_changes', {
          event: '*', schema: 'public', table: 'poll_options',
          filter: `poll_id=in.(${serverPollIds.join(',')})`,
        }, (payload) => {
          const row = (payload.new ?? payload.old) as { poll_id?: string } | null;
          if (row?.poll_id && myPollIds.has(row.poll_id)) invalidate();
        })
        .on('postgres_changes', {
          event: '*', schema: 'public', table: 'polls',
          filter: `post_id=in.(${serverPostIds.join(',')})`,
        }, (payload) => {
          const row = (payload.new ?? payload.old) as { post_id?: string } | null;
          if (row?.post_id && myPostIds.has(row.post_id)) invalidate();
        }),
    );
    return () => { detach(); };
    // ★ postIds は配列参照で毎 render 変わるため deps から外す (sortedKey に
    //   中身は含意済). q.data も参照変化を pollIdsKey に置換して churn を防ぐ.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedKey, pollIdsKey, qc]);

  return { polls: (q.data ?? {}) as Record<string, Poll>, isLoading: q.isLoading };
}

// ============================================================
// usePollVote — 楽観 toggle/select + snapshot/revert
// ============================================================
// 改訂理由 (リアルタイム反映バグ対応, 2026-05-28):
//   旧版は optimistic update が無く、UI 反映が server RTT 後 (invalidate → refetch)
//   になっていた。連投や複数選択 (multi_select) で「タップしてもしばらく反映されない」
//   現象になっていたため、useReactionToggle / useLike と同じ pattern に揃える。
//
// 反映内容 (1 vote 操作で更新する cache):
//   - my_vote_option_ids (Set of option_id)
//   - poll.options[*].vote_count (±1)
//   - poll.total_votes (±1 ただし multi_select の取り消し時のみ -1)
//
// 単一選択 (non multi_select):
//   既存の vote があれば差し替え (前の option の count -1 + 新 option +1, total は不変)
//   既存無しなら新規 (+1 / total +1)
//
// 複数選択 (multi_select):
//   - 既に含まれている → 取り消し (option -1 / total -1)
//   - 含まれていない   → 追加  (option +1 / total +1)
// ============================================================
export function usePollVote() {
  const qc = useQueryClient();

  type Vars = { pollId: string; optionId: string; multiSelect: boolean };
  type Snapshot = Array<[readonly unknown[], Record<string, Poll> | undefined]>;

  const { mutateAsync } = useMutation<void, Error, Vars, { snapshot: Snapshot }>({
    mutationFn: ({ pollId, optionId, multiSelect }) =>
      voteApi(pollId, optionId, multiSelect),
    onMutate: async ({ pollId, optionId, multiSelect }) => {
      // ★ await でレース防止 (in-flight refetch が optimistic を上書きする現象の修正)
      await qc.cancelQueries({ queryKey: [KEY_PREFIX] }).catch(() => {});

      // snapshot は patch 前 (= mutation 適用前の真の値) で取る
      const snapshot: Snapshot = qc.getQueriesData<Record<string, Poll> | undefined>({
        queryKey: [KEY_PREFIX],
      }) as Snapshot;

      // 全 polls cache (post_id → Poll) を走査し、対象 pollId の poll を patch。
      // ★ CLAUDE.md § 5.2 対策: partial-match `setQueriesData` 廃止 → exact-key 書き戻し。
      const entries = qc.getQueriesData<Record<string, Poll> | undefined>({
        queryKey: [KEY_PREFIX],
      });
      for (const [exactKey, old] of entries) {
        if (!old) continue;
        // 対象 poll を含む post key を探す (postId → Poll の Record)
        let postKey: string | null = null;
        for (const [pid, poll] of Object.entries(old)) {
          if (poll.id === pollId) {
            postKey = pid;
            break;
          }
        }
        if (!postKey) continue;
        const target = old[postKey];
        if (!target) continue;

        const myVoteIds = new Set(target.my_vote_option_ids);
        let newOptions = target.options.slice();
        let newTotal = target.total_votes;
        let newMyVotes: string[];

        if (multiSelect) {
          // toggle 動作
          if (myVoteIds.has(optionId)) {
            myVoteIds.delete(optionId);
            newOptions = newOptions.map((o) =>
              o.id === optionId ? { ...o, vote_count: Math.max(0, o.vote_count - 1) } : o,
            );
            newTotal = Math.max(0, newTotal - 1);
          } else {
            myVoteIds.add(optionId);
            newOptions = newOptions.map((o) =>
              o.id === optionId ? { ...o, vote_count: o.vote_count + 1 } : o,
            );
            newTotal = newTotal + 1;
          }
          newMyVotes = Array.from(myVoteIds);
        } else {
          // 単一選択: 既存があれば差替、無ければ新規
          const prev = target.my_vote_option_ids[0];
          if (prev === optionId) {
            // 同じ option を再選択 — no-op として扱う (server も無変更)
            continue;
          }
          newOptions = newOptions.map((o) => {
            if (o.id === optionId) return { ...o, vote_count: o.vote_count + 1 };
            if (prev && o.id === prev) return { ...o, vote_count: Math.max(0, o.vote_count - 1) };
            return o;
          });
          if (!prev) newTotal = newTotal + 1; // 新規投票時のみ total +1
          newMyVotes = [optionId];
        }

        const nextPoll: Poll = {
          ...target,
          options: newOptions,
          total_votes: newTotal,
          my_vote_option_ids: newMyVotes,
        };
        const next = { ...old, [postKey]: nextPoll };
        qc.setQueryData(exactKey, next);
      }

      return { snapshot };
    },
    onError: (e, _vars, ctx) => {
      // 楽観更新を snapshot で revert
      if (ctx?.snapshot) {
        for (const [key, data] of ctx.snapshot) qc.setQueryData(key, data);
      }
      // ログは残す (silent swallow しない)
      console.warn('[usePollVote] vote failed:', e);
    },
    onSettled: () => {
      // realtime invalidate との二重反映を server-truth で整合
      qc.invalidateQueries({ queryKey: [KEY_PREFIX], refetchType: 'active' });
    },
  });
  return {
    vote: (pollId: string, optionId: string, multiSelect: boolean) =>
      mutateAsync({ pollId, optionId, multiSelect }).catch((e) => {
        // mutateAsync の reject を呼び出し側に伝播させないが、内部の onError で
        // snapshot revert + invalidate は既に走っているので UI 整合性は保たれる。
        console.warn('[usePollVote] vote rejection:', e);
      }),
  };
}
