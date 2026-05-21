import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useToastStore } from '../stores/toastStore';

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

  const { mutateAsync } = useMutation({
    mutationFn: toggle,
    onMutate: async ({ postId }: { postId: string; wasLiked: boolean }) => {
      await qc.cancelQueries({ queryKey: ['my-likes'] });
      const prevLikes = qc.getQueriesData({ queryKey: ['my-likes'] });
      // 任意の my-likes キャッシュから当該 postId の状態を確認
      let wasLiked = false;
      for (const [, d] of prevLikes) {
        if ((d as Record<string, boolean> | undefined)?.[postId]) {
          wasLiked = true;
          break;
        }
      }

      qc.setQueriesData({ queryKey: ['my-likes'] }, (old: Record<string, boolean> | undefined) => {
        const next = { ...(old ?? {}) };
        if (next[postId]) delete next[postId];
        else next[postId] = true;
        return next;
      });

      await qc.cancelQueries({ queryKey: ['feed'] });
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

      return { prevLikes };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prevLikes) ctx.prevLikes.forEach(([k, d]) => qc.setQueryData(k, d));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['my-likes'] });
    },
  });

  // toggle() のシグネチャは旧来通り postId のみ — wasLiked はキャッシュから自動判定
  return {
    toggle: (postId: string) => {
      // キャッシュから wasLiked を判定 (mutation 内で再判定するが、SQL 側にも渡す)
      let wasLiked = false;
      const cached = qc.getQueriesData<Record<string, boolean> | undefined>({ queryKey: ['my-likes'] });
      for (const [, d] of cached) {
        if (d?.[postId]) { wasLiked = true; break; }
      }
      return mutateAsync({ postId, wasLiked }).catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : '';
        // 楽観更新の rollback は onError で実行済み — ここではユーザー通知だけ
        useToastStore.getState().show(msg ? `いいねに失敗しました: ${msg}` : 'いいねに失敗しました', 'error');
      });
    },
  };
}
