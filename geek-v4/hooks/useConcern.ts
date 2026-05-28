import { useCallback, useRef } from 'react';
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

// ============================================================
// useConcern — 楽観 toggle + snapshot/revert + smart-queue
// ============================================================
// 改訂理由 (race condition + propagation バグ対応):
//   1. smart-queue を導入。同一 postId への連打で INSERT/DELETE が並走して
//      DB 状態が不定になる race を防ぐ。useReactionToggle と同じパターン。
//   2. `setQueriesData` の partial-match 書き込みを廃止して `getQueriesData`
//      → for-loop `setQueryData(exactKey, next)` に変更。
//      CLAUDE.md § 5.2 「partial-match が散発的に伝播しない react-query v5 issue」対策。
//   3. current (concerned かどうか) は内部 cache 判定に変更。引数で渡す API を廃止。
//      呼び出し側は `toggleConcern(postId)` だけで OK。
// ============================================================
export function useConcern() {
  const qc = useQueryClient();
  // scoped selector — toast actions don't change, avoid whole-store subscription
  const show = useToastStore((s) => s.show);
  const concernsPrivate = useSettingsStore((s) => s.concernsPrivate);
  const pending = useRef<Map<string, number>>(new Map());

  type Vars = { postId: string; current: boolean };
  type Ctx = {
    prevConcerns: Array<[readonly unknown[], Record<string, boolean> | undefined]>;
    prevFeed: Array<[readonly unknown[], unknown]>;
    prevFeedPage: Array<[readonly unknown[], FeedPagePost[] | undefined]>;
  };

  const mutation = useMutation<void, Error, Vars, Ctx>({
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

      const prevConcerns = qc.getQueriesData<Record<string, boolean> | undefined>({
        queryKey: ['my-concerns'],
      });
      const prevFeed = qc.getQueriesData({ queryKey: ['feed'] });
      const prevFeedPage = snapshotFeedPage(qc);

      // 1) legacy my-concerns cache — exact-key 書き戻し (partial-match 廃止)
      const concernsEntries = qc.getQueriesData<Record<string, boolean> | undefined>({
        queryKey: ['my-concerns'],
      });
      for (const [exactKey, old] of concernsEntries) {
        const next: Record<string, boolean> = { ...(old ?? {}) };
        if (current) delete next[postId];
        else next[postId] = true;
        qc.setQueryData(exactKey, next);
      }

      // 2) useFeed infinite query — concern_count ±1 (exact-key)
      const feedEntries = qc.getQueriesData<unknown>({ queryKey: ['feed'] });
      for (const [exactKey, data] of feedEntries) {
        if (!data || typeof data !== 'object') continue;
        const old = data as { pages?: Array<{ posts: Array<{ id: string; concern_count: number }> }> };
        if (!old.pages) continue;
        const next = {
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
        qc.setQueryData(exactKey, next);
      }

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

  // cache から「現在 concerned かどうか」を判定 — my-concerns と feed-page 両方
  const readConcernedFromCache = useCallback((postId: string): boolean => {
    const cached = qc.getQueriesData<Record<string, boolean> | undefined>({ queryKey: ['my-concerns'] });
    for (const [, d] of cached) {
      if (d?.[postId]) return true;
    }
    const cachedFeedPage = qc.getQueriesData<FeedPagePost[] | undefined>({ queryKey: ['feed-page'] });
    for (const [, rows] of cachedFeedPage) {
      if (!Array.isArray(rows)) continue;
      for (const r of rows) {
        if (r.id === postId && r.my_concern) return true;
      }
    }
    return false;
  }, [qc]);

  // smart-queue: 連打吸収。in-flight 中の追加 tap は count 加算、settle 時に
  // 余剰 parity 奇数なら再 dispatch。
  const fire = useCallback((postId: string) => {
    pending.current.set(postId, 1);
    const current = readConcernedFromCache(postId);
    mutation.mutate({ postId, current }, {
      onSettled: (_data, error) => {
        const total = pending.current.get(postId) ?? 1;
        pending.current.delete(postId);
        // ★ Audit D#8: error 時は再 fire しない。
        //   失敗時は per-call onError が既に「「気になる」に失敗しました」 toast を表示し、
        //   mutation の onError が cache を revert 済み。ここで fire(postId) を再呼出すと
        //   revert 後の state に対してユーザー意図を二重計上し、再 mutation が
        //   同じ理由で失敗 → 重複トースト ("「気になる」に失敗しました" ×2) を生む。
        //   失敗時はサーバが intent を消化していないので parity を追いつかせる必要もない
        //   (UI は revert で消費前 state に戻っているため "次の tap が再開する" 動作が正)。
        if (error) return;
        const extra = total - 1;
        if (extra % 2 === 1) fire(postId);
      },
      onError: (e: unknown) => {
        const msg = e instanceof Error ? e.message : '';
        useToastStore.getState().show(
          msg ? `「気になる」に失敗しました: ${msg}` : '「気になる」に失敗しました',
          'error',
        );
      },
    });
  }, [mutation, readConcernedFromCache]);

  const toggle = useCallback((postId: string) => {
    const cur = pending.current.get(postId);
    if (cur === undefined) fire(postId);
    else pending.current.set(postId, cur + 1);
  }, [fire]);

  return { toggle, isPending: mutation.isPending };
}
