import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { attachChannel } from '../lib/realtime';
import { useToastStore } from '../stores/toastStore';
import {
  fetchReactionsForReplies,
  toggleBBSReplyReaction,
  type ReactionsByReply,
} from '../lib/api/bbsReplyReactions';
import { stableKeyFor } from '../lib/utils/queryKey';

const KEY_PREFIX = 'bbs-reply-reactions';

export function useBBSReplyReactions(replyIds: string[]) {
  const qc = useQueryClient();

  // ★ useMemo で sortedIds / sortedKey を安定化。
  //   replyIds (配列参照) は parent の useMemo 経由で来るとはいえ、ここで
  //   毎 render 新オブジェクトを作ると下流の Set / useQuery key / effect deps が
  //   churn する可能性があるため明示的に memo 化する。
  //   依存は sortedKey (string プリミティブ) に集約 — replyIds そのものは deps に
  //   入れない (= polls/reactions 兄弟 hook と同じ pattern)。
  const sortedKey = useMemo(() => stableKeyFor(replyIds.slice().sort()), [replyIds]);
  const idSet = useMemo(() => new Set(replyIds), [replyIds]);

  const q = useQuery({
    queryKey: [KEY_PREFIX, sortedKey],
    queryFn: () => fetchReactionsForReplies(replyIds),
    enabled: replyIds.length > 0,
    staleTime: 30_000,
  });

  // 最新の idSet / replyIds を ref で参照 (effect 依存を sortedKey + qc に絞るため)
  const idSetRef = useRef(idSet);
  idSetRef.current = idSet;
  const replyIdsRef = useRef(replyIds);
  replyIdsRef.current = replyIds;

  useEffect(() => {
    if (!sortedKey) return;
    // server-side filter: 現在表示中の reply_id のみ。全 BBS スレッドのリアクションを
    // 受け取ると無駄な fanout が発生する。30 件 cap は filter 文字列長 + 性能の trade-off。
    const serverIds = replyIdsRef.current.slice().sort().slice(0, 30);
    return attachChannel(`bbs-reply-reactions:${sortedKey.slice(0, 64)}`, (ch) =>
      ch.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bbs_reply_reactions',
          filter: `reply_id=in.(${serverIds.join(',')})`,
        },
        (payload) => {
          const row = (payload.new ?? payload.old) as { reply_id?: string } | null;
          // idSet の参照は ref 経由 (deps churn を避けるため)
          if (row?.reply_id && idSetRef.current.has(row.reply_id)) {
            // 全 KEY_PREFIX 総当たりではなく、現在の sortedKey のクエリだけを invalidate
            // (他の BBS スレッドが同時に開かれている場合に巻き込まない)
            qc.invalidateQueries({ queryKey: [KEY_PREFIX, sortedKey] });
          }
        },
      ),
    );
  }, [sortedKey, qc]);

  return { data: (q.data ?? {}) as ReactionsByReply, isLoading: q.isLoading };
}

// ============================================================
// useBBSReplyReactionToggle — 楽観 toggle + snapshot revert + smart-queue
// ============================================================
// useReactionToggle と同形。連打で DELETE×2 が並走して use_count が二重消費
// される critical bug を防ぐ + smart-queue で N 連打の parity を server-truth
// に整合させる (MemeReactionPicker の XOR 楽観表示と server が乖離しないよう)。
// snapshot は setQueriesData の前で取って onError 時に確実に revert。
// ============================================================
export function useBBSReplyReactionToggle() {
  const qc = useQueryClient();
  const pending = useRef<Map<string, number>>(new Map());

  type Vars = { replyId: string; meme: string };
  type Snapshot = Array<[readonly unknown[], ReactionsByReply | undefined]>;

  const mutation = useMutation<boolean, Error, Vars, { snapshot: Snapshot }>({
    mutationFn: ({ replyId, meme }) => toggleBBSReplyReaction(replyId, meme),
    onMutate: async ({ replyId, meme }) => {
      // ★ await を復活: in-flight refetch のキャンセル完了を待ってから
      //   optimistic を書き込む。fire-and-forget だと refetch のレスポンスが
      //   optimistic 値を上書きして「タップしても反映されない」現象になる。
      //   useReactionToggle 側で同じ修正が既に入っているが、こちらは旧コメント
      //   の「体感速度優先」のまま放置されていた (3 兄弟 hook の非対称)。
      await qc.cancelQueries({ queryKey: [KEY_PREFIX] }).catch(() => {});
      const snapshot: Snapshot = qc.getQueriesData<ReactionsByReply | undefined>({
        queryKey: [KEY_PREFIX],
      }) as Snapshot;
      // ★ CLAUDE.md § 5.2 「partial-match setQueriesData が伝播しない」issue 対策:
      //   getQueriesData で exact key 列挙 → setQueryData 逐次。
      const entries = qc.getQueriesData<ReactionsByReply | undefined>({
        queryKey: [KEY_PREFIX],
      });
      for (const [exactKey, old] of entries) {
        if (!old) continue;
        if (!(replyId in old)) continue;
        const next = { ...old };
        const list = (next[replyId] ?? []).slice();
        const idx = list.findIndex((r) => r.meme === meme);
        const cur = idx >= 0 ? list[idx] : undefined;
        if (cur) {
          if (cur.mine) {
            const newCount = cur.count - 1;
            if (newCount <= 0) list.splice(idx, 1);
            else list[idx] = { meme: cur.meme, count: newCount, mine: false };
          } else {
            list[idx] = { meme: cur.meme, count: cur.count + 1, mine: true };
          }
        } else {
          list.push({ meme, count: 1, mine: true });
        }
        list.sort((a, b) => b.count - a.count);
        next[replyId] = list;
        qc.setQueryData(exactKey, next);
      }
      return { snapshot };
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.snapshot) {
        for (const [key, data] of ctx.snapshot) qc.setQueryData(key, data);
      }
      qc.invalidateQueries({ queryKey: [KEY_PREFIX] });
      const msg = e instanceof Error ? e.message : '';
      useToastStore.getState().show(
        msg ? `リアクションに失敗しました: ${msg}` : 'リアクションに失敗しました',
        'error',
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: [KEY_PREFIX] });
    },
  });

  const fire = useCallback((vars: Vars) => {
    const k = `${vars.replyId}:${vars.meme}`;
    pending.current.set(k, 1);
    mutation.mutate(vars, {
      onSettled: (_data, error) => {
        const total = pending.current.get(k) ?? 1;
        pending.current.delete(k);
        // ★ Audit D#8: error 時は再 fire しない。
        //   mutation の onError が既に snapshot revert + 「リアクションに失敗しました」
        //   toast を表示済み。ここで fire(vars) を再呼出すと revert 後の state に
        //   対してユーザー意図を二重計上し、再 mutation が同じ理由で失敗 → 重複
        //   トースト ("リアクションに失敗しました" ×2) を生む。失敗時はサーバが
        //   intent を消化していないので parity を追いつかせる必要もない。
        if (error) return;
        const extra = total - 1;
        if (extra % 2 === 1) fire(vars);
      },
    });
  }, [mutation]);

  const toggle = useCallback((replyId: string, meme: string) => {
    const k = `${replyId}:${meme}`;
    const cur = pending.current.get(k);
    if (cur === undefined) fire({ replyId, meme });
    else pending.current.set(k, cur + 1);
  }, [fire]);

  return { toggle, isPending: mutation.isPending };
}
