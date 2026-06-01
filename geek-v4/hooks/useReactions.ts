import { useCallback, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { attachChannel } from '../lib/realtime';
import { fetchReactionsForPosts, toggleReaction, type ReactionAgg, type ReactionsByPost } from '../lib/api/reactions';
import { useToastStore } from '../stores/toastStore';
import { stableKeyFor } from '../lib/utils/queryKey';
import {
  FEED_PAGE_KEY,
  patchFeedPagePost,
  snapshotFeedPage,
  revertFeedPageSnapshot,
  invalidateFeedPage,
} from '../lib/cacheUpdates/feedPagePatcher';
import type { FeedPagePost } from '../lib/api/feedPage';

const KEY_PREFIX = 'reactions';

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

function keyForIds(postIds: string[]) {
  return [KEY_PREFIX, stableKeyFor(postIds.slice().sort())];
}

// 投稿IDの集合に対するリアクション一括取得 + Realtime 反映 (legacy 経路)
// ※ 本番では useFeedPage (RPC) が reactions を担う。
//   useReactions は RPC fallback 時のみ使われる。realtime subscription は
//   useFeedRealtime.ts (常時起動) が主担当。
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
    // ★ deps を sortedKey + qc に限定 (postIds は配列参照で毎 render 変わるため
    //   含めると毎 render channel が detach/attach され Supabase pool 枯渇の原因に).
    //   postIds の中身は sortedKey に含意される.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedKey, qc]);

  return { data: (q.data ?? {}) as ReactionsByPost, isLoading: q.isLoading };
}

// ============================================================
// useReactionToggle — 楽観 toggle + snapshot/revert + smart-queue
// ============================================================
// 改訂理由 (リアルタイム反映バグ対応):
//   1. 旧版は legacy reactions cache (['reactions']) と feed-page cache
//      (['feed-page', userId, sortedKey]) の両方を inline で更新していた。
//      共通 helper (patchFeedPagePost) に集約することで保守と動作の一貫性を確保。
//   2. **await cancelQueries を復活**。
//      旧版は fire-and-forget で「体感速度優先」だったが、in-flight refetch
//      (フォーカス時 / mount 時) が optimistic 適用直後に v0 で cache を
//      上書きするレース条件で「クリックしても反映されない」現象を発生させていた。
//      ms オーダーの遅延で UX への影響は軽微、対して正しさへの寄与は決定的。
//   3. onError 時に両 cache を snapshot で revert。
//   4. 連打 (同一 postId+meme への連続 tap) で server-side toggle が
//      DELETE×2 と並走し use_count が二重消費される critical bug を防ぐ
//      → pending counter で in-flight 中の追加 tap をカウントだけして、settle 時に
//        余剰タップ数の parity を見て net toggle を再 dispatch する smart-queue 方式。
//        単純 drop だと MemeReactionPicker の XOR 楽観表示 (localFlips) と
//        server-side state が乖離するので、最終的に server が user の visual 意図に
//        追いつくようにする (N 連打 → ceil(N/2) 回 dispatch で最終状態が parity に整う)。
// ============================================================
export function useReactionToggle() {
  const qc = useQueryClient();
  // key (postId:meme) → そのキーについて settle 待ち中の累積 tap 数。
  // 1 = 初回 dispatch のみ。2+ = in-flight 中に追加 tap があった。
  const pending = useRef<Map<string, number>>(new Map());

  type Vars = { postId: string; meme: string };
  type Snapshot = {
    reactions: Array<[readonly unknown[], ReactionsByPost | undefined]>;
    feedPage: Array<[readonly unknown[], FeedPagePost[] | undefined]>;
  };

  const mutation = useMutation<boolean, Error, Vars, { snapshot: Snapshot }>({
    mutationFn: ({ postId, meme }) => toggleReaction(postId, meme),
    onMutate: async ({ postId, meme }) => {
      // snapshot は patch 前 (= mutation 適用前の真の値) で取る
      const snapshot: Snapshot = {
        reactions: qc.getQueriesData<ReactionsByPost | undefined>({
          queryKey: [KEY_PREFIX],
        }) as Snapshot['reactions'],
        feedPage: snapshotFeedPage(qc),
      };

      // ★ 楽観パッチを「await より先に・同期で」当てる → クリック即反映。
      //   旧版は冒頭で `await cancelQueries` してから patch していたが、Supabase は
      //   AbortController 非対応で in-flight の feed-page RPC refetch の cancel 完了待ちが
      //   数秒に及び、「クリックしてから反映まで時差(実測 ~3s)」の原因になっていた。
      //   patch を await の前に出せば cancel の所要時間に関係なく UI は即時に反映される。
      // 1) legacy reactions cache (旧 useReactions 経路の fallback 用)
      const legacyEntries = qc.getQueriesData<ReactionsByPost | undefined>({
        queryKey: [KEY_PREFIX],
      });
      for (const [exactKey, old] of legacyEntries) {
        if (!old || !(postId in old)) continue;
        const next: ReactionsByPost = { ...old, [postId]: applyToggle(old[postId] ?? [], meme) };
        qc.setQueryData(exactKey, next);
      }
      // 2) ★ feed-page RPC cache (本番 feed の主要表示元) — helper 経由で exact-key 書き戻し。
      patchFeedPagePost(qc, postId, (p) => ({
        ...p,
        reactions: applyToggle(p.reactions ?? [], meme),
      }));

      // in-flight refetch の結果が後から楽観値を v0 で上書きするのを防ぐため cancel する。
      // ★ revert: false が要点 — default(true) だと、in-flight query の cancel 時に
      //   データを fetch 開始前へ巻き戻し、たった今当てた楽観パッチまで打ち消してしまう。
      //   revert:false なら「in-flight の結果は破棄するが現在の cache (=楽観値) は触らない」。
      // cancelQueries の cancel 自体は同期発火するので、patch と同一 tick で in-flight は
      // cancel 済み。patch は既に当たっているため、ここの await は UI 反映を遅らせない。
      await Promise.all([
        qc.cancelQueries({ queryKey: [KEY_PREFIX] }, { revert: false }).catch(() => {}),
        qc.cancelQueries({ queryKey: [FEED_PAGE_KEY] }, { revert: false }).catch(() => {}),
      ]);

      return { snapshot };
    },
    onError: (e, _vars, ctx) => {
      // 楽観更新を snapshot で revert (両 cache とも)
      if (ctx?.snapshot) {
        for (const [key, data] of ctx.snapshot.reactions) qc.setQueryData(key, data);
        revertFeedPageSnapshot(qc, ctx.snapshot.feedPage);
      }
      qc.invalidateQueries({ queryKey: [KEY_PREFIX] });
      invalidateFeedPage(qc);
      const msg = e instanceof Error ? e.message : '';
      useToastStore.getState().show(
        msg ? `リアクションに失敗しました: ${msg}` : 'リアクションに失敗しました',
        'error',
      );
    },
    onSettled: () => {
      // realtime invalidate との二重反映を server-truth で整合 (両 cache とも)
      // refetchType: 'active' を明示 — staleTime>0 の query でも mount 中なら確実 refetch
      qc.invalidateQueries({ queryKey: [KEY_PREFIX], refetchType: 'active' });
      invalidateFeedPage(qc);
    },
  });

  // smart-queue: 初回 tap → 即 dispatch、in-flight 中の追加 tap は count を
  // 加算するだけ。settle 時に (count - 1) が奇数なら net toggle を再 dispatch
  // することで「N 連打した結果の parity」が server-truth に反映される。
  // これにより picker XOR (localFlips) の visual と server が必ず最終一致する。
  // mutation オブジェクトは毎 render で新 ref になるため、安定参照の mutation.mutate
  // にのみ依存させる。これで fire/toggle が安定し、feed の handlersByPostId 再生成 →
  // AnonPostCard memo 全崩壊を防ぐ (perf)。
  const mutate = mutation.mutate;
  const fire = useCallback((vars: Vars) => {
    const k = `${vars.postId}:${vars.meme}`;
    pending.current.set(k, 1);
    mutate(vars, {
      onSettled: (_data, error) => {
        const total = pending.current.get(k) ?? 1;
        pending.current.delete(k);
        // ★ Audit D#8: error 時は再 fire しない。
        //   mutation の onError が既に snapshot revert + toast 表示済みで、
        //   ここで fire(vars) を再呼出すると revert 後の state に対して
        //   ユーザー意図を二重計上し、追加の失敗 → 重複トースト("いいねに失敗
        //   しました" ×2) を生む。失敗時はサーバが intent を消化していない
        //   ので parity を追いつかせる必要もない (localFlips も revert される).
        if (error) return;
        const extra = total - 1;
        if (extra % 2 === 1) fire(vars); // 余剰が奇数 → もう一度 toggle
      },
    });
  }, [mutate]);

  const toggle = useCallback((postId: string, meme: string) => {
    const k = `${postId}:${meme}`;
    const cur = pending.current.get(k);
    if (cur === undefined) fire({ postId, meme });
    else pending.current.set(k, cur + 1); // in-flight 中: count を加算
  }, [fire]);

  return { toggle, isPending: mutation.isPending };
}
