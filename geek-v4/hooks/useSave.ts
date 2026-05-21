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

// SELECT を省略して 1 RTT で完了。wasSaved は呼び出し側 (キャッシュ) が知っている。
// unique 制約で race condition (連打) を吸収。
async function toggle({ postId, wasSaved }: { postId: string; wasSaved: boolean }): Promise<boolean> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) throw new Error('Not authenticated');
  if (wasSaved) {
    await supabase.from('saves').delete().eq('user_id', userId).eq('post_id', postId);
    return false;
  } else {
    const { error } = await supabase
      .from('saves')
      .upsert({ user_id: userId, post_id: postId }, { onConflict: 'user_id,post_id', ignoreDuplicates: true });
    if (error) throw error;
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
  // scoped selector — avoid re-render on every toast push/dismiss
  const show = useToastStore((s) => s.show);

  const { mutateAsync } = useMutation({
    mutationFn: toggle,
    onMutate: async ({ postId }: { postId: string; wasSaved: boolean }) => {
      await qc.cancelQueries({ queryKey: ['my-saves'] });
      // 失敗時 rollback のため snapshot を取る
      const prevSaves = qc.getQueriesData({ queryKey: ['my-saves'] });
      qc.setQueriesData({ queryKey: ['my-saves'] }, (old: Record<string, boolean> | undefined) => {
        const next = { ...(old ?? {}) };
        if (next[postId]) delete next[postId];
        else next[postId] = true;
        return next;
      });
      return { prevSaves };
    },
    onSuccess: (newState) => {
      show(newState ? '保存しました' : '保存を解除しました', 'success');
    },
    onError: (_e, _v, ctx) => {
      // 楽観更新を巻き戻してから通知
      if (ctx?.prevSaves) ctx.prevSaves.forEach(([k, d]) => qc.setQueryData(k, d));
      show('保存に失敗しました', 'error');
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['my-saves'] });
      qc.invalidateQueries({ queryKey: ['saved-posts'] });
    },
  });

  return {
    toggle: (postId: string) => {
      // 現在の保存状態を React Query キャッシュから取得
      let wasSaved = false;
      const cached = qc.getQueriesData<Record<string, boolean> | undefined>({ queryKey: ['my-saves'] });
      for (const [, d] of cached) {
        if (d?.[postId]) { wasSaved = true; break; }
      }
      // onError でトーストを出すのでここでは握り潰す (unhandled rejection 防止)
      return mutateAsync({ postId, wasSaved }).catch((e: unknown) => {
        console.warn('[useSave] toggle failed:', e);
      });
    },
  };
}
