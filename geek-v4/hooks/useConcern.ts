import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addConcern, getMyConcerns, removeConcern } from '@/lib/api/concerns';
import { useToastStore } from '@/stores/toastStore';

export function useConcerns(postIds: string[]) {
  return useQuery({
    queryKey: ['my-concerns', postIds.slice().sort().join(',')],
    queryFn: () => getMyConcerns(postIds),
    enabled: postIds.length > 0,
    staleTime: 30_000,
  });
}

export function useConcern() {
  const qc = useQueryClient();
  const { show } = useToastStore();

  const { mutateAsync } = useMutation({
    mutationFn: async ({ postId, current }: { postId: string; current: boolean }) => {
      if (current) await removeConcern(postId);
      else await addConcern(postId, 'other');
    },
    onMutate: async ({ postId, current }) => {
      await qc.cancelQueries({ queryKey: ['my-concerns'] });
      qc.setQueriesData({ queryKey: ['my-concerns'] }, (old: Record<string, boolean> | undefined) => {
        const next = { ...(old ?? {}) };
        if (current) delete next[postId];
        else next[postId] = true;
        return next;
      });

      qc.setQueriesData({ queryKey: ['feed'] }, (data: unknown) => {
        if (!data || typeof data !== 'object') return data;
        const old = data as { pages?: Array<{ posts: Array<{ id: string; concern_count: number }> }> };
        if (!old.pages) return data;
        return {
          ...old,
          pages: old.pages.map((p) => ({
            ...p,
            posts: p.posts.map((post) =>
              post.id === postId
                ? { ...post, concern_count: Math.max(0, post.concern_count + (current ? -1 : 1)) }
                : post,
            ),
          })),
        };
      });
    },
    onSuccess: (_d, { current }) => {
      show(current ? '「気になる」を取り消しました' : 'マークしました。多くの人が気になると評価が下がります', 'info');
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['my-concerns'] });
    },
  });

  return {
    toggle: (postId: string, current: boolean) => mutateAsync({ postId, current }).catch(() => {}),
  };
}
