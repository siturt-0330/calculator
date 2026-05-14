import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toggleLike } from '@/lib/api/posts';

export function useLike() {
  const qc = useQueryClient();

  const { mutate } = useMutation({
    mutationFn: toggleLike,
    onMutate: async (postId) => {
      // 楽観的更新: likes_count +1
      await qc.cancelQueries({ queryKey: ['feed'] });
      const prev = qc.getQueriesData({ queryKey: ['feed'] });
      qc.setQueriesData({ queryKey: ['feed'] }, (old: unknown) => {
        if (!old || typeof old !== 'object') return old;
        const pages = (old as { pages: Array<{ posts: Array<{ id: string; likes_count: number }> }> }).pages;
        return {
          ...(old as object),
          pages: pages.map((page) => ({
            ...page,
            posts: page.posts.map((p) =>
              p.id === postId ? { ...p, likes_count: p.likes_count + 1 } : p,
            ),
          })),
        };
      });
      return { prev };
    },
    onError: (_err, _postId, ctx) => {
      if (ctx?.prev) {
        ctx.prev.forEach(([queryKey, data]) => qc.setQueryData(queryKey, data));
      }
    },
  });

  return { toggle: (postId: string) => mutate(postId) };
}
