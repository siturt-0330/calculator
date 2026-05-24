import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addConcern, getMyConcerns, removeConcern } from '../lib/api/concerns';
import { useToastStore } from '../stores/toastStore';
import { useSettingsStore } from '../stores/settingsStore';
import {
  patchFeedPagePost,
  snapshotFeedPage,
  revertFeedPageSnapshot,
  invalidateFeedPage,
} from '../lib/cacheUpdates/feedPagePatcher';
import type { FeedPagePost } from '../lib/api/feedPage';

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
  // scoped selector — toast actions don't change, avoid whole-store subscription
  const show = useToastStore((s) => s.show);
  const concernsPrivate = useSettingsStore((s) => s.concernsPrivate);

  type Vars = { postId: string; current: boolean };
  type Ctx = {
    prevConcerns: Array<[readonly unknown[], unknown]>;
    prevFeed: Array<[readonly unknown[], unknown]>;
    prevFeedPage: Array<[readonly unknown[], FeedPagePost[] | undefined]>;
  };

  const { mutateAsync } = useMutation<void, Error, Vars, Ctx>({
    mutationFn: async ({ postId, current }) => {
      if (current) await removeConcern(postId);
      else await addConcern(postId, 'other', concernsPrivate);
    },
    onMutate: async ({ postId, current }) => {
      // ★ await でレース防止
      await Promise.all([
        qc.cancelQueries({ queryKey: ['my-concerns'] }).catch(() => {}),
        qc.cancelQueries({ queryKey: ['feed'] }).catch(() => {}),
        qc.cancelQueries({ queryKey: ['feed-page'] }).catch(() => {}),
      ]);

      const prevConcerns = qc.getQueriesData({ queryKey: ['my-concerns'] });
      const prevFeed = qc.getQueriesData({ queryKey: ['feed'] });
      const prevFeedPage = snapshotFeedPage(qc);

      // 1) legacy my-concerns cache
      qc.setQueriesData({ queryKey: ['my-concerns'] }, (old: Record<string, boolean> | undefined) => {
        const next = { ...(old ?? {}) };
        if (current) delete next[postId];
        else next[postId] = true;
        return next;
      });

      // 2) useFeed infinite query — concern_count ±1
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

      // 3) ★ RPC cache (feed-page) — my_concern + concern_count
      patchFeedPagePost(qc, postId, (p) => ({
        ...p,
        my_concern: !current,
        concern_count: Math.max(0, (p.concern_count ?? 0) + (current ? -1 : 1)),
      }));

      return { prevConcerns, prevFeed, prevFeedPage };
    },
    onError: (_e, _v, ctx) => {
      // 楽観更新を巻き戻す — server 真値に戻す
      if (!ctx) return;
      for (const [k, d] of ctx.prevConcerns) qc.setQueryData(k, d);
      for (const [k, d] of ctx.prevFeed) qc.setQueryData(k, d);
      revertFeedPageSnapshot(qc, ctx.prevFeedPage);
    },
    onSuccess: (_d, { current }) => {
      if (current) {
        show('「気になる」を取り消しました', 'info');
      } else {
        show(
          concernsPrivate
            ? 'こっそりマーク済み (投稿主には届きません)'
            : 'マーク済み。多くの人が気になると評価に影響します',
          'info',
        );
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['my-concerns'] });
      invalidateFeedPage(qc);
    },
  });

  return {
    toggle: (postId: string, current: boolean) =>
      mutateAsync({ postId, current }).catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : '';
        // 楽観更新の rollback は onError で実行済み — ここではユーザー通知だけ
        useToastStore.getState().show(
          msg ? `「気になる」に失敗しました: ${msg}` : '「気になる」に失敗しました',
          'error',
        );
      }),
  };
}
