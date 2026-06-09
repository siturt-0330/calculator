import { useCallback, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useToastStore } from '../stores/toastStore';
import {
  patchFeedPagePost,
  snapshotFeedPage,
  revertFeedPageSnapshot,
  invalidateFeedPage,
} from '../lib/cacheUpdates/feedPagePatcher';
import type { FeedPagePost } from '../lib/api/feedPage';

async function getMyLikes(postIds: string[]): Promise<Record<string, boolean>> {
  if (postIds.length === 0) return {};
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) return {};
  const { data } = await supabase
    .from('likes')
    .select('post_id')
    .eq('user_id', userId)
    .in('post_id', postIds);
  const map: Record<string, boolean> = {};
  for (const row of (data ?? []) as Array<{ post_id: string }>) {
    map[row.post_id] = true;
  }
  return map;
}

// 既知の現在状態 (キャッシュ由来) を受け取り、SELECT を省略して 1 RTT で toggle する。
// 1000 並行ユーザー時にも各 like 操作が server に 1 リクエストしか出さない。
// 不一致時 (キャッシュ stale) は onError で revert される。
async function toggleLikeApi({ postId, wasLiked }: { postId: string; wasLiked: boolean }): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) throw new Error('Not authenticated');
  if (wasLiked) {
    await supabase.from('likes').delete().eq('user_id', userId).eq('post_id', postId);
  } else {
    // upsert で race condition (連打) を吸収。重複 PK は無視されエラーにならない。
    const { error } = await supabase
      .from('likes')
      .upsert({ user_id: userId, post_id: postId }, { onConflict: 'user_id,post_id', ignoreDuplicates: true });
    if (error) throw error;
  }
}

export function useLikes(postIds: string[]) {
  return useQuery({
    queryKey: ['my-likes', postIds.slice().sort().join(',')],
    queryFn: () => getMyLikes(postIds),
    enabled: postIds.length > 0,
    staleTime: 30_000,
  });
}

// ============================================================
// useLike — 楽観 toggle + snapshot/revert + smart-queue
// ============================================================
// 改訂理由 (race condition + propagation バグ対応):
//   1. smart-queue を導入。同一 postId への連打で INSERT/DELETE が並走して
//      DB 状態が不定になる race を防ぐ。in-flight 中の追加 tap は count を
//      加算するだけで、settle 時に余剰の parity が奇数なら net toggle を
//      再 dispatch する (useReactionToggle と同じパターン)。
//   2. `setQueriesData` の partial-match 書き込みを廃止して `getQueriesData`
//      → for-loop `setQueryData(exactKey, next)` に変更。
//      CLAUDE.md § 5.2 にある「partial-match が散発的に伝播しない react-query v5
//      issue」対策。`['my-likes', sortedIdsJoinString]` 派生キーが複数あるとき
//      一部だけ更新されない問題を解消。
//   3. wasLiked は fire 内で最新 cache から判定。再 dispatch 時にも正しく動く。
// ============================================================
export function useLike() {
  const qc = useQueryClient();
  // postId → そのキーについて settle 待ち中の累積 tap 数。
  // 1 = 初回 dispatch のみ。2+ = in-flight 中に追加 tap があった。
  const pending = useRef<Map<string, number>>(new Map());

  type Vars = { postId: string; wasLiked: boolean };
  type Ctx = {
    prevLikes: Array<[readonly unknown[], Record<string, boolean> | undefined]>;
    prevFeed: Array<[readonly unknown[], unknown]>;
    prevFeedPage: Array<[readonly unknown[], FeedPagePost[] | undefined]>;
    prevCommunity: Array<[readonly unknown[], unknown]>;
  };

  const mutation = useMutation<void, Error, Vars, Ctx>({
    mutationFn: toggleLikeApi,
    onMutate: async ({ postId, wasLiked }) => {
      // ★ useReactionToggle と同じ順序:
      //   1) snapshot を取る (in-flight query が flush する前の値)
      //   2) optimistic patch を同期で適用
      //   3) cancelQueries で in-flight refetch をキャンセル (patch が上書きされるのを防ぐ)
      //
      //   以前は cancelQueries を await してから snapshot → patch していたため、
      //   cancelQueries が RQ 内部で同期 cache 書き込みをトリガする場合に
      //   snapshot が「cancelQueries 後の値」を掴むことがあった (audit 指摘)。

      // 1) snapshot — patch 前の真の値
      const prevLikes = qc.getQueriesData<Record<string, boolean> | undefined>({
        queryKey: ['my-likes'],
      });
      const prevFeed = qc.getQueriesData({ queryKey: ['feed'] });
      const prevFeedPage = snapshotFeedPage(qc);
      const prevCommunity = qc.getQueriesData({ queryKey: ['community'] });

      // 2) optimistic patch (同期)
      // legacy my-likes cache — exact-key 書き戻し (partial-match 廃止)
      const likesEntries = qc.getQueriesData<Record<string, boolean> | undefined>({
        queryKey: ['my-likes'],
      });
      for (const [exactKey, old] of likesEntries) {
        const next: Record<string, boolean> = { ...(old ?? {}) };
        if (next[postId]) delete next[postId];
        else next[postId] = true;
        qc.setQueryData(exactKey, next);
      }

      // 2) useFeed の infinite query cache — likes_count を ±1 (exact-key)
      const feedEntries = qc.getQueriesData<unknown>({ queryKey: ['feed'] });
      for (const [exactKey, data] of feedEntries) {
        if (!data || typeof data !== 'object') continue;
        const old = data as { pages?: Array<{ posts: Array<{ id: string; likes_count: number }> }> };
        if (!old.pages) continue;
        const next = {
          ...old,
          pages: old.pages.map((p) => ({
            ...p,
            posts: p.posts.map((post) =>
              post.id === postId
                ? { ...post, likes_count: Math.max(0, post.likes_count + (wasLiked ? -1 : 1)) }
                : post,
            ),
          })),
        };
        qc.setQueryData(exactKey, next);
      }

      // 2.5) コミュニティ詳細 feed cache (['community', id, 'feed', sort] → Post[]) — likes_count を ±1。
      //   コミュ feed は useFeedPage を使わず post.likes_count を直接表示するため、ここを更新しないと
      //   「コミュニティでいいねしても数が増えない」bug になる。配列の cache だけを対象にする
      //   (['community', id] = metadata オブジェクトは Array でないのでスキップされる)。
      const communityEntries = qc.getQueriesData<unknown>({ queryKey: ['community'] });
      for (const [exactKey, data] of communityEntries) {
        if (!Array.isArray(data)) continue;
        let touched = false;
        const next = (data as Array<{ id: string; likes_count: number }>).map((p) => {
          if (p && p.id === postId) {
            touched = true;
            return { ...p, likes_count: Math.max(0, (p.likes_count ?? 0) + (wasLiked ? -1 : 1)) };
          }
          return p;
        });
        if (touched) qc.setQueryData(exactKey, next);
      }

      // 3) ★ RPC cache (feed-page) — my_like + likes_count を更新
      //    feed.tsx は full.my_like / full.likes_count を参照するので、ここを更新しないと UI 反映 0。
      patchFeedPagePost(qc, postId, (p) => ({
        ...p,
        my_like: !wasLiked,
        likes_count: Math.max(0, (p.likes_count ?? 0) + (wasLiked ? -1 : 1)),
      }));

      // 3) cancelQueries — optimistic patch 適用後に in-flight refetch をキャンセルする。
      //   patch 前に await すると RQ が flush して snapshot が汚染されるため、必ず patch 後。
      await Promise.all([
        qc.cancelQueries({ queryKey: ['my-likes'] }).catch(() => {}),
        qc.cancelQueries({ queryKey: ['feed'] }).catch(() => {}),
        qc.cancelQueries({ queryKey: ['feed-page'] }).catch(() => {}),
        qc.cancelQueries({ queryKey: ['community'] }).catch(() => {}),
      ]);

      return { prevLikes, prevFeed, prevFeedPage, prevCommunity };
    },
    onError: (_e, _v, ctx) => {
      if (!ctx) return;
      for (const [k, d] of ctx.prevLikes) qc.setQueryData(k, d);
      for (const [k, d] of ctx.prevFeed) qc.setQueryData(k, d);
      revertFeedPageSnapshot(qc, ctx.prevFeedPage);
      for (const [k, d] of ctx.prevCommunity) qc.setQueryData(k, d);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['my-likes'] });
      invalidateFeedPage(qc);
    },
  });

  // cache から「現在 liked かどうか」を判定。my-likes と feed-page の両方を見る。
  const readLikedFromCache = useCallback((postId: string): boolean => {
    const cachedLikes = qc.getQueriesData<Record<string, boolean> | undefined>({ queryKey: ['my-likes'] });
    for (const [, d] of cachedLikes) {
      if (d?.[postId]) return true;
    }
    const cachedFeedPage = qc.getQueriesData<FeedPagePost[] | undefined>({ queryKey: ['feed-page'] });
    for (const [, rows] of cachedFeedPage) {
      if (!Array.isArray(rows)) continue;
      for (const r of rows) {
        if (r.id === postId && r.my_like) return true;
      }
    }
    return false;
  }, [qc]);

  // smart-queue: 初回 tap → 即 dispatch、in-flight 中の追加 tap は count を加算するだけ。
  // settle 時に (count - 1) が奇数なら net toggle を再 dispatch することで
  // 「N 連打した結果の parity」が server-truth に反映される。
  const fire = useCallback((postId: string) => {
    pending.current.set(postId, 1);
    const wasLiked = readLikedFromCache(postId);
    mutation.mutate({ postId, wasLiked }, {
      onSettled: (_data, error) => {
        const total = pending.current.get(postId) ?? 1;
        pending.current.delete(postId);
        // ★ Audit D#8: error 時は再 fire しない。
        //   失敗時は per-call onError が既に「いいねに失敗しました」 toast を表示し、
        //   mutation の onError が cache を revert 済み。ここで fire(postId) を再呼出すと
        //   revert 後の state に対してユーザー意図を二重計上し、再 mutation が
        //   同じ理由で失敗 → 重複トースト ("いいねに失敗しました" ×2) を生む。
        //   失敗時はサーバが intent を消化していないので parity を追いつかせる必要もない
        //   (UI は revert で消費前 state に戻っているため "次の tap が再開する" 動作が正)。
        if (error) return;
        const extra = total - 1;
        if (extra % 2 === 1) fire(postId); // 余剰が奇数 → もう一度 toggle
      },
      onError: (e: unknown) => {
        const msg = e instanceof Error ? e.message : '';
        useToastStore.getState().show(
          msg ? `いいねに失敗しました: ${msg}` : 'いいねに失敗しました',
          'error',
        );
      },
    });
  }, [mutation, readLikedFromCache]);

  const toggle = useCallback((postId: string) => {
    const cur = pending.current.get(postId);
    if (cur === undefined) fire(postId);
    else pending.current.set(postId, cur + 1); // in-flight 中: count を加算
  }, [fire]);

  return { toggle, isPending: mutation.isPending };
}
