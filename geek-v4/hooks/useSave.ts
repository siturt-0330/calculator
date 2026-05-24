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

  type Vars = { postId: string; wasSaved: boolean };
  type Ctx = {
    prevSaves: Array<[readonly unknown[], unknown]>;
    prevFeedPage: Array<[readonly unknown[], FeedPagePost[] | undefined]>;
  };

  const { mutateAsync } = useMutation<boolean, Error, Vars, Ctx>({
    mutationFn: toggle,
    onMutate: async ({ postId, wasSaved }) => {
      // ★ await でレース防止
      await Promise.all([
        qc.cancelQueries({ queryKey: ['my-saves'] }).catch(() => {}),
        qc.cancelQueries({ queryKey: ['feed-page'] }).catch(() => {}),
      ]);

      const prevSaves = qc.getQueriesData({ queryKey: ['my-saves'] });
      const prevFeedPage = snapshotFeedPage(qc);

      // 1) legacy my-saves cache
      qc.setQueriesData({ queryKey: ['my-saves'] }, (old: Record<string, boolean> | undefined) => {
        const next = { ...(old ?? {}) };
        if (next[postId]) delete next[postId];
        else next[postId] = true;
        return next;
      });

      // 2) ★ RPC cache (feed-page) — my_save
      patchFeedPagePost(qc, postId, (p) => ({
        ...p,
        my_save: !wasSaved,
      }));

      return { prevSaves, prevFeedPage };
    },
    onSuccess: (newState) => {
      show(newState ? '保存しました' : '保存を解除しました', 'success');
    },
    onError: (_e, _v, ctx) => {
      // 楽観更新を巻き戻してから通知
      if (!ctx) return;
      for (const [k, d] of ctx.prevSaves) qc.setQueryData(k, d);
      revertFeedPageSnapshot(qc, ctx.prevFeedPage);
      show('保存に失敗しました', 'error');
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['my-saves'] });
      qc.invalidateQueries({ queryKey: ['saved-posts'] });
      invalidateFeedPage(qc);
    },
  });

  return {
    toggle: (postId: string) => {
      // 現在の保存状態を React Query キャッシュから取得 — my-saves と feed-page 両方
      let wasSaved = false;
      const cached = qc.getQueriesData<Record<string, boolean> | undefined>({ queryKey: ['my-saves'] });
      for (const [, d] of cached) {
        if (d?.[postId]) { wasSaved = true; break; }
      }
      if (!wasSaved) {
        const cachedFeedPage = qc.getQueriesData<FeedPagePost[] | undefined>({ queryKey: ['feed-page'] });
        outer: for (const [, rows] of cachedFeedPage) {
          if (!Array.isArray(rows)) continue;
          for (const r of rows) {
            if (r.id === postId && r.my_save) {
              wasSaved = true;
              break outer;
            }
          }
        }
      }
      // onError でトーストを出すのでここでは握り潰す (unhandled rejection 防止)
      return mutateAsync({ postId, wasSaved }).catch((e: unknown) => {
        console.warn('[useSave] toggle failed:', e);
      });
    },
  };
}
