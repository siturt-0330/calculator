// ============================================================
// hooks/useTrending.ts — get_trending_topics の RQ wrapper
// ------------------------------------------------------------
// lib/api/search.ts の薄い React Query v5 wrapper。
//   - useTrendingTopics: Discovery タブのトレンド一覧
//
// staleTime 5min (サーバ側で集計済み MV を読むので頻繁に動かない)。
// ============================================================

import { useQuery } from '@tanstack/react-query';
import { getTrendingTopics, type TrendingTopic } from '../lib/api/search';

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
