import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useToastStore } from '../stores/toastStore';

async function getMySaves(postIds: string[]): Promise<Record<string, boolean>> {
  if (postIds.length === 0) return {};
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) return {};
  const { data } = await supabase
    .from('saves')
    .select('post_id')
    .eq('user_id', userId)
    .in('post_id', postIds);
  const map: Record<string, boolean> = {};
  for (const r of (data ?? []) as Array<{ post_id: string }>) map[r.post_id] = true;
  return map;
}

async function toggle(postId: string): Promise<boolean> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) throw new Error('Not authenticated');
  const { data: existing } = await supabase
    .from('saves')
    .select('post_id')
    .eq('user_id', userId)
    .eq('post_id', postId)
    .maybeSingle();
  if (existing) {
    await supabase.from('saves').delete().eq('user_id', userId).eq('post_id', postId);
    return false;
  } else {
    await supabase.from('saves').insert({ user_id: userId, post_id: postId });
    return true;
  }
}

export function useSaves(postIds: string[]) {
  return useQuery({
    queryKey: ['my-saves', postIds.slice().sort().join(',')],
    queryFn: () => getMySaves(postIds),
    enabled: postIds.length > 0,
    staleTime: 30_000,
  });
}

export function useSave() {
  const qc = useQueryClient();
  const { show } = useToastStore();

  const { mutateAsync } = useMutation({
    mutationFn: toggle,
    onMutate: async (postId: string) => {
      await qc.cancelQueries({ queryKey: ['my-saves'] });
      qc.setQueriesData({ queryKey: ['my-saves'] }, (old: Record<string, boolean> | undefined) => {
        const next = { ...(old ?? {}) };
        if (next[postId]) delete next[postId];
        else next[postId] = true;
        return next;
      });
    },
    onSuccess: (newState) => {
      show(newState ? '保存しました' : '保存を解除しました', 'success');
    },
    onError: () => {
      show('保存に失敗しました', 'error');
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['my-saves'] });
      qc.invalidateQueries({ queryKey: ['saved-posts'] });
    },
  });

  return { toggle: (postId: string) => mutateAsync(postId).catch(() => {}) };
}
