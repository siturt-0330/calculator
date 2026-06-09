// ============================================================
// lib/feed/feedQuery.ts — ホームフィード 1ページ目の query 契約を共有
// ------------------------------------------------------------
// useFeed (画面 mount 時) と app/_layout.tsx (起動時 prefetch) の両方が
// 「同一 queryKey + 同一 queryFn」でホームフィード1ページ目を取得できるように
// 切り出した単一ソース。これにより:
//   - 起動時に prefetch → フィード画面 mount 時には取得済/取得中 (React Query が
//     同 key の in-flight promise を dedupe) → 投稿カードが即表示される。
//   - prefetch と画面の取得ロジックが drift しない (get_home_feed/fetchPosts の
//     分岐を 1 箇所に集約)。
//
// ★ key は useFeed.ts の useInfiniteQuery と完全一致させること
//   (['feed', sort, scope, likedTags, blockedTags])。ズレると prefetch が当たらない
//   (= 無害だが効果なし)。
// ============================================================
import type { QueryClient } from '@tanstack/react-query';
import type { Post } from '../../types/models';
import type { SortMode } from '../api/posts';
import type { FeedScope } from '../../stores/feedStore';
import { fetchPosts } from '../api/posts';
import {
  fetchHomeFeedFirstPage,
  fetchForYouFeedFirstPage,
  seedHomeFeedSurroundingCaches,
  HOME_FEED_RPC_ENABLED,
  FOR_YOU_FEED_RPC_ENABLED,
} from '../api/homeFeed';

export type FeedPageResult = { posts: Post[]; nextCursor: string | null };

/** useInfiniteQuery(['feed', ...]) の key。useFeed と prefetch で共有する単一ソース。 */
export function feedQueryKey(
  sort: SortMode,
  scope: FeedScope,
  likedTags: string[],
  blockedTags: string[],
): (string | string[])[] {
  return ['feed', sort, scope, likedTags, blockedTags];
}

/**
 * ホームフィード「1ページ目」を取得する (cursor 無し)。
 * 既定 (for-you + open) かつ flag ON なら get_home_feed RPC で 1 RTT 集約し周辺 cache を
 * seed する。それ以外 / RPC 失敗 / 0件は現行 fetchPosts へ完全 fallback (= 回帰なし)。
 *
 * useFeed の queryFn (cursor===undefined 分岐) と app/_layout.tsx の prefetch が共用。
 */
export async function fetchFeedFirstPage(opts: {
  sort: SortMode;
  scope: FeedScope;
  likedTags: string[];
  blockedTags: string[];
  userId: string | null;
  qc: QueryClient;
}): Promise<FeedPageResult> {
  const { sort, scope, likedTags, blockedTags, userId, qc } = opts;
  const filterTags = scope === 'closed' && likedTags.length > 0 ? likedTags : undefined;

  if (sort === 'for-you' && scope === 'open') {
    // Value Model 個人化フィード (0141): タグ親和性・既読除外・コールドスタートを適用
    if (FOR_YOU_FEED_RPC_ENABLED) {
      const forYou = await fetchForYouFeedFirstPage(userId);
      if (forYou) {
        seedHomeFeedSurroundingCaches(qc, userId, forYou.posts);
        return { posts: forYou.posts as Post[], nextCursor: forYou.nextCursor };
      }
    }
    // hot プール集約 fallback (0114)
    if (HOME_FEED_RPC_ENABLED) {
      const home = await fetchHomeFeedFirstPage(userId);
      if (home) {
        seedHomeFeedSurroundingCaches(qc, userId, home.posts);
        return { posts: home.posts as Post[], nextCursor: home.nextCursor };
      }
    }
  }
  return fetchPosts({ sort, likedTags, blockedTags, filterTags, cursor: undefined, home: true });
}
