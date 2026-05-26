import { useCallback, useEffect, useRef } from 'react';
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

function keyForIds(replyIds: string[]) {
  return [KEY_PREFIX, stableKeyFor(replyIds.slice().sort())];
}

export function useBBSReplyReactions(replyIds: string[]) {
  const qc = useQueryClient();
  const sortedIds = replyIds.slice().sort();
  const sortedKey = stableKeyFor(sortedIds);

  const q = useQuery({
    queryKey: keyForIds(replyIds),
    queryFn: () => fetchReactionsForReplies(replyIds),
    enabled: replyIds.length > 0,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!sortedKey) return;
    const idSet = new Set(sortedIds);
    // server-side filter: 現在表示中の reply_id のみ。全 BBS スレッドのリアクションを
    // 受け取ると無駄な fanout が発生する。
    const serverIds = sortedIds.slice(0, 30);
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
          if (row?.reply_id && idSet.has(row.reply_id)) {
            // 全 KEY_PREFIX 総当たりではなく、現在の sortedKey のクエリだけを invalidate
            // (他の BBS スレッドが同時に開かれている場合に巻き込まない)
            qc.invalidateQueries({ queryKey: [KEY_PREFIX, sortedKey] });
          }
        },
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      qc.setQueriesData<ReactionsByReply | undefined>(
        { queryKey: [KEY_PREFIX] },
        (old) => {
          if (!old) return old;
          if (!(replyId in old)) return old;
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
          return next;
        },
      );
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
      onSettled: () => {
        const total = pending.current.get(k) ?? 1;
        pending.current.delete(k);
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
