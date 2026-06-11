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
async function toggleSaveApi({ postId, wasSaved }: { postId: string; wasSaved: boolean }): Promise<boolean> {
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

// ============================================================
// useSave — 楽観 toggle + snapshot/revert + smart-queue
// ============================================================
// useLike と同じパターン。連打で upsert/delete が並走して DB 状態が不定になる
// race を smart-queue で吸収。`setQueriesData` partial-match → exact-key 書き戻し。
// ============================================================
export function useSave() {
  const qc = useQueryClient();
  // scoped selector — avoid re-render on every toast push/dismiss
  const show = useToastStore((s) => s.show);
  const pending = useRef<Map<string, number>>(new Map());

  type Vars = { postId: string; wasSaved: boolean };
  type Ctx = {
    prevSaves: Array<[readonly unknown[], Record<string, boolean> | undefined]>;
    prevFeedPage: Array<[readonly unknown[], FeedPagePost[] | undefined]>;
  };

  const mutation = useMutation<boolean, Error, Vars, Ctx>({
    mutationFn: toggleSaveApi,
    onMutate: async ({ postId, wasSaved }) => {
      // ★ snapshot を先取り (await の前)。cancel を待たず楽観 patch を同期適用して反映を即時化し、
      //   in-flight cancel は patch の後に revert:false で行う (useLike/useReactionToggle と同順序)。
      const prevSaves = qc.getQueriesData<Record<string, boolean> | undefined>({
        queryKey: ['my-saves'],
      });
      const prevFeedPage = snapshotFeedPage(qc);

      // 1) legacy my-saves cache — exact-key 書き戻し (partial-match 廃止)
      const savesEntries = qc.getQueriesData<Record<string, boolean> | undefined>({
        queryKey: ['my-saves'],
      });
      for (const [exactKey, old] of savesEntries) {
        const next: Record<string, boolean> = { ...(old ?? {}) };
        if (next[postId]) delete next[postId];
        else next[postId] = true;
        qc.setQueryData(exactKey, next);
      }

      // 2) ★ RPC cache (feed-page) — my_save
      patchFeedPagePost(qc, postId, (p) => ({
        ...p,
        my_save: !wasSaved,
      }));

      // in-flight refetch を cancel (楽観 patch の後・revert:false で patch を巻き戻させない)
      await Promise.all([
        qc.cancelQueries({ queryKey: ['my-saves'] }, { revert: false }).catch(() => {}),
        qc.cancelQueries({ queryKey: ['feed-page'] }, { revert: false }).catch(() => {}),
      ]);

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

  // cache から「現在 saved かどうか」を判定 — my-saves と feed-page 両方
  const readSavedFromCache = useCallback((postId: string): boolean => {
    const cached = qc.getQueriesData<Record<string, boolean> | undefined>({ queryKey: ['my-saves'] });
    for (const [, d] of cached) {
      if (d?.[postId]) return true;
    }
    const cachedFeedPage = qc.getQueriesData<FeedPagePost[] | undefined>({ queryKey: ['feed-page'] });
    for (const [, rows] of cachedFeedPage) {
      if (!Array.isArray(rows)) continue;
      for (const r of rows) {
        if (r.id === postId && r.my_save) return true;
      }
    }
    return false;
  }, [qc]);

  // smart-queue: 連打を吸収。in-flight 中の追加 tap は count を加算し、
  // settle 時に余剰の parity が奇数なら再 dispatch。
  const fire = useCallback((postId: string) => {
    pending.current.set(postId, 1);
    const wasSaved = readSavedFromCache(postId);
    mutation.mutate({ postId, wasSaved }, {
      onSettled: (_data, error) => {
        const total = pending.current.get(postId) ?? 1;
        pending.current.delete(postId);
        // ★ Audit D#8: error 時は再 fire しない。
        //   mutation の onError が既に snapshot revert + 「保存に失敗しました」 toast
        //   を表示済み。ここで fire(postId) を再呼出すと revert 後の state に対して
        //   ユーザー意図を二重計上し、再 mutation が同じ理由で失敗 → 重複トースト
        //   ("保存に失敗しました" ×2) を生む。失敗時はサーバが intent を消化して
        //   いないので parity を追いつかせる必要もない (UI は revert で消費前 state)。
        if (error) return;
        const extra = total - 1;
        if (extra % 2 === 1) fire(postId);
      },
    });
  }, [mutation, readSavedFromCache]);

  const toggle = useCallback((postId: string) => {
    const cur = pending.current.get(postId);
    if (cur === undefined) fire(postId);
    else pending.current.set(postId, cur + 1);
  }, [fire]);

  return { toggle, isPending: mutation.isPending };
}
