import { useCallback, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { attachChannel } from '../lib/realtime';
import {
  fetchCommentReactionsForComments,
  toggleCommentReaction,
  type ReactionAgg,
  type ReactionsByComment,
} from '../lib/api/commentReactions';
import { useToastStore } from '../stores/toastStore';
import { stableKeyFor } from '../lib/utils/queryKey';

const KEY_PREFIX = 'comment-reactions';

// 1 つの reactions リストに対して 1 toggle を適用する純関数。
// chip の visual と server 双方が同じ deterministic な遷移をする。
function applyToggle(list: ReactionAgg[], meme: string): ReactionAgg[] {
  const next = list.slice();
  const idx = next.findIndex((r) => r.meme === meme);
  const cur = idx >= 0 ? next[idx] : undefined;
  if (cur) {
    if (cur.mine) {
      const newCount = cur.count - 1;
      if (newCount <= 0) next.splice(idx, 1);
      else next[idx] = { meme: cur.meme, count: newCount, mine: false };
    } else {
      next[idx] = { meme: cur.meme, count: cur.count + 1, mine: true };
    }
  } else {
    next.push({ meme, count: 1, mine: true });
  }
  next.sort((a, b) => b.count - a.count);
  return next;
}

function keyForIds(commentIds: string[]) {
  return [KEY_PREFIX, stableKeyFor(commentIds.slice().sort())];
}

// comment ID の集合に対するリアクション一括取得 + Realtime 反映。
// post_reactions と同じ pattern: server-side filter で payload 削減 + idSet で
// 取りこぼし弾き、現在の view scope だけ invalidate する。
export function useCommentReactions(commentIds: string[]) {
  const qc = useQueryClient();
  const sortedIds = commentIds.slice().sort();
  const sortedKey = stableKeyFor(sortedIds);

  const q = useQuery({
    queryKey: keyForIds(commentIds),
    queryFn: () => fetchCommentReactionsForComments(commentIds),
    enabled: commentIds.length > 0,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (commentIds.length === 0) return;
    // server-side filter: 現在表示中の comment_id のみ受け取る (上限 30件)
    // 全 comment_reactions の UPDATE を受け取ると、画面に出てないコメントの反応まで毎回
    // 配信されて fanout がスケールしない。
    const serverIds = commentIds.slice(0, 30);
    // O(1) lookup — payload filter で取りこぼした行をクライアント側で確実に弾く。
    const idSet = new Set(commentIds);
    return attachChannel(`comment-reactions:${sortedKey.slice(0, 64)}`, (ch) =>
      ch.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'comment_reactions',
          filter: `comment_id=in.(${serverIds.join(',')})`,
        },
        (payload) => {
          const row = (payload.new ?? payload.old) as { comment_id?: string } | null;
          if (!row?.comment_id || !idSet.has(row.comment_id)) return;
          // 現在のリストの query だけを refetch。
          // predicate で全 reactions キーを総当たりすると 1000+ ユーザー時に
          // 各クライアントが他人の subscriptions まで巻き込む可能性があった。
          // 自分の view の sortedKey 一致だけにスコープする。
          qc.invalidateQueries({ queryKey: [KEY_PREFIX, sortedKey] });
        },
      ),
    );
    // ★ deps を sortedKey + qc に限定 (commentIds は配列参照で毎 render 変わるため
    //   含めると毎 render channel が detach/attach され Supabase pool 枯渇の原因に).
    //   commentIds の中身は sortedKey に含意される.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedKey, qc]);

  return { data: (q.data ?? {}) as ReactionsByComment, isLoading: q.isLoading };
}

// ============================================================
// useCommentReactionToggle — 楽観 toggle + snapshot/revert + smart-queue
// ============================================================
// useReactionToggle (post_reactions 用) を comment_reactions に移植したもの。
// comments は feed-page RPC cache に含まれないため、legacy reactions cache
// (= [KEY_PREFIX, ...]) のみを更新する (post 版にあった feedPagePatcher は不要).
//
// 主要パターン:
//   1. await cancelQueries で in-flight refetch を確実に止めてから optimistic 適用。
//      これをしないと refetch のレスポンスが optimistic 値を上書きして
//      「クリックしても反映されない」現象になる。
//   2. snapshot は patch 前 (= mutation 適用前の真の値) で取って onError で revert。
//   3. 連打 (同一 commentId+meme への連続 tap) で server-side toggle が
//      DELETE×2 と並走するレースを防ぐ smart-queue 方式。
//      初回 dispatch + in-flight 中の追加 tap は count 加算のみ → settle 時に
//      余剰タップ数の parity を見て net toggle を再 dispatch。
//      ★ Audit D#8 の error 時 early-return parity bug fix も忠実に移植 (下記).
// ============================================================
export function useCommentReactionToggle() {
  const qc = useQueryClient();
  // key (commentId:meme) → そのキーについて settle 待ち中の累積 tap 数。
  // 1 = 初回 dispatch のみ。2+ = in-flight 中に追加 tap があった。
  const pending = useRef<Map<string, number>>(new Map());

  type Vars = { commentId: string; meme: string };
  type Snapshot = {
    reactions: Array<[readonly unknown[], ReactionsByComment | undefined]>;
  };

  const mutation = useMutation<boolean, Error, Vars, { snapshot: Snapshot }>({
    mutationFn: ({ commentId, meme }) => toggleCommentReaction({ commentId, meme }),
    onMutate: async ({ commentId, meme }) => {
      // ★ await を復活: in-flight refetch のキャンセル完了を待ってから
      //   optimistic を書き込む。これをしないと refetch のレスポンスが
      //   optimistic 値を上書きして「クリックしても反映されない」現象になる。
      await qc.cancelQueries({ queryKey: [KEY_PREFIX] }).catch(() => {});

      // snapshot は patch 前 (= mutation 適用前の真の値) で取る
      const snapshot: Snapshot = {
        reactions: qc.getQueriesData<ReactionsByComment | undefined>({
          queryKey: [KEY_PREFIX],
        }) as Snapshot['reactions'],
      };

      // legacy reactions cache (useCommentReactions が読む key) を patch
      const legacyEntries = qc.getQueriesData<ReactionsByComment | undefined>({
        queryKey: [KEY_PREFIX],
      });
      for (const [exactKey, old] of legacyEntries) {
        if (!old || !(commentId in old)) continue;
        const next: ReactionsByComment = {
          ...old,
          [commentId]: applyToggle(old[commentId] ?? [], meme),
        };
        qc.setQueryData(exactKey, next);
      }

      return { snapshot };
    },
    onError: (e, _vars, ctx) => {
      // 楽観更新を snapshot で revert
      if (ctx?.snapshot) {
        for (const [key, data] of ctx.snapshot.reactions) qc.setQueryData(key, data);
      }
      qc.invalidateQueries({ queryKey: [KEY_PREFIX] });
      const msg = e instanceof Error ? e.message : '';
      useToastStore.getState().show(
        msg ? `リアクションに失敗しました: ${msg}` : 'リアクションに失敗しました',
        'error',
      );
    },
    onSettled: () => {
      // realtime invalidate との二重反映を server-truth で整合
      // refetchType: 'active' を明示 — staleTime>0 の query でも mount 中なら確実 refetch
      qc.invalidateQueries({ queryKey: [KEY_PREFIX], refetchType: 'active' });
    },
  });

  // smart-queue: 初回 tap → 即 dispatch、in-flight 中の追加 tap は count を
  // 加算するだけ。settle 時に (count - 1) が奇数なら net toggle を再 dispatch
  // することで「N 連打した結果の parity」が server-truth に反映される。
  // これにより picker XOR (localFlips) の visual と server が必ず最終一致する。
  const fire = useCallback((vars: Vars) => {
    const k = `${vars.commentId}:${vars.meme}`;
    pending.current.set(k, 1);
    mutation.mutate(vars, {
      onSettled: (_data, error) => {
        const total = pending.current.get(k) ?? 1;
        pending.current.delete(k);
        // ★ Audit D#8: error 時は再 fire しない。
        //   mutation の onError が既に snapshot revert + toast 表示済みで、
        //   ここで fire(vars) を再呼出すると revert 後の state に対して
        //   ユーザー意図を二重計上し、追加の失敗 → 重複トースト("リアクションに失敗
        //   しました" ×2) を生む。失敗時はサーバが intent を消化していない
        //   ので parity を追いつかせる必要もない (localFlips も revert される).
        if (error) return;
        const extra = total - 1;
        if (extra % 2 === 1) fire(vars); // 余剰が奇数 → もう一度 toggle
      },
    });
  }, [mutation]);

  const toggle = useCallback((commentId: string, meme: string) => {
    const k = `${commentId}:${meme}`;
    const cur = pending.current.get(k);
    if (cur === undefined) fire({ commentId, meme });
    else pending.current.set(k, cur + 1); // in-flight 中: count を加算
  }, [fire]);

  return { toggle, isPending: mutation.isPending };
}
