import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

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

async function toggle(postId: string): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) throw new Error('Not authenticated');
  const { data: existing } = await supabase
    .from('likes')
    .select('post_id')
    .eq('user_id', userId)
    .eq('post_id', postId)
    .maybeSingle();
  if (existing) {
    await supabase.from('likes').delete().eq('user_id', userId).eq('post_id', postId);
  } else {
    await supabase.from('likes').insert({ user_id: userId, post_id: postId });
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
    onMutate: async (postId: string) => {
      await qc.cancelQueries({ queryKey: ['my-likes'] });
      const prevLikes = qc.getQueriesData({ queryKey: ['my-likes'] });
      const wasLiked = !!(prevLikes[0]?.[1] as Record<string, boolean> | undefined)?.[postId];

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

  return { toggle: (postId: string) => mutateAsync(postId).catch(() => {}) };
}
