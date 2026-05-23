import { useCallback, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { attachChannel } from '../lib/realtime';
import { fetchReactionsForPosts, toggleReaction, type ReactionsByPost } from '../lib/api/reactions';
import { useToastStore } from '../stores/toastStore';

const KEY_PREFIX = 'reactions';

// postIds が 200+ のとき queryKey に全 ID を連結すると重い + devtools が辛い。
// 50 を超えたら短い決定的ハッシュで畳む。
function stableKeyFor(sortedIds: string[]): string {
  if (sortedIds.length <= 50) return sortedIds.join(',');
  // djb2 hash (32bit, deterministic)
  let h = 5381;
  const s = sortedIds.join(',');
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `n${sortedIds.length}:${(h >>> 0).toString(36)}`;
}

function keyForIds(postIds: string[]) {
  return [KEY_PREFIX, stableKeyFor(postIds.slice().sort())];
}

// 投稿IDの集合に対するリアクション一括取得 + Realtime 反映
export function useReactions(postIds: string[]) {
  const qc = useQueryClient();
  const sortedIds = postIds.slice().sort();
  const sortedKey = stableKeyFor(sortedIds);

  const q = useQuery({
    queryKey: keyForIds(postIds),
    queryFn: () => fetchReactionsForPosts(postIds),
    enabled: postIds.length > 0,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (postIds.length === 0) return;
    // server-side filter: 現在表示中の post_id のみ受け取る (上限 30件)
    // 全 post_reactions の UPDATE を受け取ると、画面に出てない投稿の反応まで毎回
    // 配信されて fanout がスケールしない。
    const serverIds = postIds.slice(0, 30);
    // O(1) lookup — payload filter で取りこぼした行をクライアント側で確実に弾く。
    const idSet = new Set(postIds);
    return attachChannel(`reactions:${sortedKey.slice(0, 64)}`, (ch) =>
      ch.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'post_reactions',
          filter: `post_id=in.(${serverIds.join(',')})`,
        },
        (payload) => {
          const row = (payload.new ?? payload.old) as { post_id?: string } | null;
          if (!row?.post_id || !idSet.has(row.post_id)) return;
          // 現在のリストの query だけを refetch。
          // predicate で全 reactions キーを総当たりすると 1000+ ユーザー時に
          // 各クライアントが他人の subscriptions まで巻き込む可能性があった。
          // 自分の view の sortedKey 一致だけにスコープする。
          qc.invalidateQueries({ queryKey: [KEY_PREFIX, sortedKey] });
        },
      ),
    );
  }, [sortedKey, postIds, qc]);

  return { data: (q.data ?? {}) as ReactionsByPost, isLoading: q.isLoading };
}

// ============================================================
// useReactionToggle — 楽観 toggle + snapshot/revert + smart-queue
// ============================================================
// 改訂理由:
//   1. 連打 (同一 postId+meme への連続 tap) で server-side toggle が
//      DELETE×2 と並走し use_count が二重消費される critical bug を防ぐ
//      → pending counter で in-flight 中の追加 tap をカウントだけして、settle 時に
//        余剰タップ数の parity を見て net toggle を再 dispatch する smart-queue 方式。
//        単純 drop だと MemeReactionPicker の XOR 楽観表示 (localFlips) と
//        server-side state が乖離するので、最終的に server が user の visual 意図に
//        追いつくようにする (N 連打 → ceil(N/2) 回 dispatch で最終状態が parity に整う)。
//   2. onError 時に snapshot を戻す revert を入れることで「失敗したのに
//      画面では押されたまま残る」現象を排除。
//   3. useCommunityStampReactionToggle と同じ snapshot/revert パターンに統一。
// ============================================================
export function useReactionToggle() {
  const qc = useQueryClient();
  // key (postId:meme) → そのキーについて settle 待ち中の累積 tap 数。
  // 1 = 初回 dispatch のみ。2+ = in-flight 中に追加 tap があった。
  const pending = useRef<Map<string, number>>(new Map());

  type Vars = { postId: string; meme: string };
  type Snapshot = Array<[readonly unknown[], ReactionsByPost | undefined]>;

  const mutation = useMutation<boolean, Error, Vars, { snapshot: Snapshot }>({
    mutationFn: ({ postId, meme }) => toggleReaction(postId, meme),
    onMutate: async ({ postId, meme }) => {
      await qc.cancelQueries({ queryKey: [KEY_PREFIX] });
      // snapshot は setQueriesData の前 (= mutation 適用前の真の値) で取る
      const snapshot: Snapshot = qc.getQueriesData<ReactionsByPost | undefined>({
        queryKey: [KEY_PREFIX],
      }) as Snapshot;
      qc.setQueriesData<ReactionsByPost | undefined>(
        { queryKey: [KEY_PREFIX] },
        (old) => {
          if (!old) return old;
          if (!(postId in old)) return old;
          const next = { ...old };
          const list = (next[postId] ?? []).slice();
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
          next[postId] = list;
          return next;
        },
      );
      return { snapshot };
    },
    onError: (e, _vars, ctx) => {
      // 楽観更新を snapshot で revert
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
      // realtime invalidate との二重反映を server-truth で整合
      qc.invalidateQueries({ queryKey: [KEY_PREFIX] });
    },
  });

  // smart-queue: 初回 tap → 即 dispatch、in-flight 中の追加 tap は count を
  // 加算するだけ。settle 時に (count - 1) が奇数なら net toggle を再 dispatch
  // することで「N 連打した結果の parity」が server-truth に反映される。
  // これにより picker XOR (localFlips) の visual と server が必ず最終一致する。
  const fire = useCallback((vars: Vars) => {
    const k = `${vars.postId}:${vars.meme}`;
    pending.current.set(k, 1);
    mutation.mutate(vars, {
      onSettled: () => {
        const total = pending.current.get(k) ?? 1;
        pending.current.delete(k);
        const extra = total - 1;
        if (extra % 2 === 1) fire(vars); // 余剰が奇数 → もう一度 toggle
      },
    });
  }, [mutation]);

  const toggle = useCallback((postId: string, meme: string) => {
    const k = `${postId}:${meme}`;
    const cur = pending.current.get(k);
    if (cur === undefined) fire({ postId, meme });
    else pending.current.set(k, cur + 1); // in-flight 中: count を加算
  }, [fire]);

  return { toggle, isPending: mutation.isPending };
}
