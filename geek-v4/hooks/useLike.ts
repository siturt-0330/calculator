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
async function toggle({ postId, wasLiked }: { postId: string; wasLiked: boolean }): Promise<void> {
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

export function useLike() {
  const qc = useQueryClient();

  type Vars = { postId: string; wasLiked: boolean };
  type Ctx = {
    prevLikes: Array<[readonly unknown[], unknown]>;
    prevFeed: Array<[readonly unknown[], unknown]>;
    prevFeedPage: Array<[readonly unknown[], FeedPagePost[] | undefined]>;
  };

  const { mutateAsync } = useMutation<void, Error, Vars, Ctx>({
    mutationFn: toggle,
    onMutate: async ({ postId, wasLiked }) => {
      // ★ await でレース防止 (in-flight refetch が optimistic を上書きする現象の修正)
      await Promise.all([
        qc.cancelQueries({ queryKey: ['my-likes'] }).catch(() => {}),
        qc.cancelQueries({ queryKey: ['feed'] }).catch(() => {}),
        qc.cancelQueries({ queryKey: ['feed-page'] }).catch(() => {}),
      ]);

      const prevLikes = qc.getQueriesData({ queryKey: ['my-likes'] });
      const prevFeed = qc.getQueriesData({ queryKey: ['feed'] });
      const prevFeedPage = snapshotFeedPage(qc);

      // 1) legacy my-likes cache (fallback 経路)
      qc.setQueriesData({ queryKey: ['my-likes'] }, (old: Record<string, boolean> | undefined) => {
        const next = { ...(old ?? {}) };
        if (next[postId]) delete next[postId];
        else next[postId] = true;
        return next;
      });

      // 2) useFeed の infinite query cache — likes_count を ±1
      qc.setQueriesData({ queryKey: ['feed'] }, (data: unknown) => {
        if (!data || typeof data !== 'object') return data;
        const old = data as { pages?: Array<{ posts: Array<{ id: string; likes_count: number }> }> };
        if (!old.pages) return data;
        return {
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
      });

      // 3) ★ RPC cache (feed-page) — my_like + likes_count を更新
      //    feed.tsx は full.my_like / post.likes_count を参照するので、ここを更新しないと UI 反映 0。
      patchFeedPagePost(qc, postId, (p) => ({
        ...p,
        my_like: !wasLiked,
        likes_count: Math.max(0, (p.likes_count ?? 0) + (wasLiked ? -1 : 1)),
      }));

      return { prevLikes, prevFeed, prevFeedPage };
    },
    onError: (_e, _v, ctx) => {
      if (!ctx) return;
      for (const [k, d] of ctx.prevLikes) qc.setQueryData(k, d);
      for (const [k, d] of ctx.prevFeed) qc.setQueryData(k, d);
      revertFeedPageSnapshot(qc, ctx.prevFeedPage);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['my-likes'] });
      invalidateFeedPage(qc);
    },
  });

  // toggle() のシグネチャは旧来通り postId のみ — wasLiked はキャッシュから自動判定
  return {
    toggle: (postId: string) => {
      // キャッシュから wasLiked を判定: my-likes と feed-page の両方を見る
      let wasLiked = false;
      const cachedLikes = qc.getQueriesData<Record<string, boolean> | undefined>({ queryKey: ['my-likes'] });
      for (const [, d] of cachedLikes) {
        if (d?.[postId]) { wasLiked = true; break; }
      }
      if (!wasLiked) {
        // RPC cache を fallback で見る (my-likes が空でも feed-page にはあるかも)
        const cachedFeedPage = qc.getQueriesData<FeedPagePost[] | undefined>({ queryKey: ['feed-page'] });
        outer: for (const [, rows] of cachedFeedPage) {
          if (!Array.isArray(rows)) continue;
          for (const r of rows) {
            if (r.id === postId && r.my_like) {
              wasLiked = true;
              break outer;
            }
          }
        }
      }
      return mutateAsync({ postId, wasLiked }).catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : '';
        // 楽観更新の rollback は onError で実行済み — ここではユーザー通知だけ
        useToastStore.getState().show(msg ? `いいねに失敗しました: ${msg}` : 'いいねに失敗しました', 'error');
      });
    },
  };
}
