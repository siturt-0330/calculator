// ============================================================
// hooks/useFeedPage.ts
// ------------------------------------------------------------
// フィードの 1 ページ分の周辺データ (communities / official_author /
// my_like|concern|save / reactions / added_tags / poll) を 1 RPC で取得する。
//
// 旧構成:
//   useLikes(ids) + useConcerns(ids) + useSaves(ids) + useReactions(ids)
//   + useAddedTags(ids) + usePolls(ids) + communitiesByPost(useFeed 経由)
//   → 6 個の React Query が並列で発射。各々が個別の HTTP request。
//
// 新構成:
//   useFeedPage(ids) → fetchFeedPage(ids, userId) を 1 個の React Query で呼ぶ。
//   戻り値: { fullPosts: Map<post_id, FeedPagePost>, isLoading }
//
// フォールバック設計:
//   - 失敗時 (RPC 未適用 / network error) は fetchFeedPage が空配列を返す
//   - fullPosts が空のときは feed.tsx 側で旧 hook 群を fallback する設計が可能
//   - ENV flag (EXPO_PUBLIC_FEED_PAGE_RPC=0) で強制的に旧経路へ戻せる
// ============================================================
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useAuthStore } from '../stores/authStore';
import { fetchFeedPage, type FeedPagePost } from '../lib/api/feedPage';

// ENV flag: '0' を立てると useFeedPage は disable (空 Map を返す)。
// feed.tsx 側でこの値を見て旧 hook 群へ切り替えるためのキルスイッチ。
// build 時に static 評価 (process.env.EXPO_PUBLIC_... は Expo がインライン化)。
export const FEED_PAGE_RPC_ENABLED =
  process.env.EXPO_PUBLIC_FEED_PAGE_RPC !== '0';

const KEY_PREFIX = 'feed-page';

export type UseFeedPageResult = {
  fullPosts: Map<string, FeedPagePost>;
  isLoading: boolean;
  /** ENV flag や postIds 0 件で disable されている時に true */
  isDisabled: boolean;
  /** RPC 呼出は成功したが結果が 0 件 (= RPC 未適用 / RLS 全 deny 等の可能性) */
  isEmpty: boolean;
};

export function useFeedPage(postIds: string[]): UseFeedPageResult {
  // user.id を React state として購読 (signin/signout で再 fetch される)
  const userId = useAuthStore((s) => s.user?.id ?? null);

  // postIds の中身に依存して安定化する key。中身が同じなら参照不変。
  const sortedKey = useMemo(
    () => postIds.slice().sort().join(','),
    [postIds],
  );

  // postIds を変化しにくい参照で持つ — useMemo で配列を安定化
  const stablePostIds = useMemo(
    () => postIds,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sortedKey],
  );

  const enabled = FEED_PAGE_RPC_ENABLED && stablePostIds.length > 0;

  const q = useQuery({
    queryKey: [KEY_PREFIX, userId ?? 'anon', sortedKey],
    queryFn: () => fetchFeedPage(stablePostIds, userId),
    enabled,
    staleTime: 30_000,
    // RPC が落ちても旧 hook 群へフォールバックできるよう、retry は控えめに
    retry: 1,
  });

  const fullPosts = useMemo(() => {
    const m = new Map<string, FeedPagePost>();
    const rows = q.data ?? [];
    for (const r of rows) m.set(r.id, r);
    return m;
  }, [q.data]);

  return {
    fullPosts,
    isLoading: q.isLoading,
    isDisabled: !enabled,
    isEmpty: !!q.data && q.data.length === 0,
  };
}
