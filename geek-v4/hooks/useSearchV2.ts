// ============================================================
// hooks/useSearchV2.ts — search_posts_v2 / get_trending_topics の RQ wrapper
// ------------------------------------------------------------
// lib/api/search.ts の薄い React Query v5 wrapper。
//   - useSearchV2: クエリ入力に対する投稿検索 (空クエリは disable)
//   - useTrendingTopics: Discovery タブのトレンド一覧
//
// staleTime:
//   - search   : 60s  (同じクエリは 1 分間 fresh — 連打で連続 RPC を避ける)
//   - trending : 5min (サーバ側で集計済み MV を読むので頻繁に動かない)
//
// placeholderData = keepPreviousData:
//   ユーザーがタイプ中に query が変わると enabled が再評価されるが、
//   前回の結果を保ったまま新クエリを取得することで UI の "0 件 flicker" を回避。
// ============================================================

import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  searchPostsV2,
  getTrendingTopics,
  type SearchPostsV2Args,
  type SearchPostResult,
  type TrendingTopic,
} from '../lib/api/search';

/**
 * 投稿の v2 検索フック。
 *
 * - query が空白のみのときは `enabled: false` で RPC を呼ばない
 * - query 文字列を queryKey に含める ため key 衝突は起きない
 * - placeholderData=keepPreviousData で flicker 回避
 */
export function useSearchV2(args: SearchPostsV2Args) {
  const query = args.query.trim();
  const limit = args.limit ?? 20;
  const offset = args.offset ?? 0;

  return useQuery<SearchPostResult[]>({
    queryKey: ['searchV2', query, limit, offset],
    queryFn: () => searchPostsV2({ query, limit, offset }),
    enabled: query.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

/**
 * トレンドトピックのフック。
 *
 * @param windowHours 集計 window (default 24)
 * @param limit       件数 (default 10)
 */
export function useTrendingTopics(windowHours = 24, limit = 10) {
  return useQuery<TrendingTopic[]>({
    queryKey: ['trendingTopics', windowHours, limit],
    queryFn: () => getTrendingTopics(windowHours, limit),
    staleTime: 5 * 60_000,
  });
}
