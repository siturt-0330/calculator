// ============================================================
// lib/api/search.ts — Search client API (server RPC wrapper)
// ------------------------------------------------------------
// backend RPC への薄い wrapper。
//   - get_trending_topics: 直近 N 時間の topic ランキング
//
// 既存の search 機構は lib/search/* (client-side) と
// lib/api/trending.ts (server-side) に分離されており、
// このファイルは「server RPC を直接叩く経路」を担当する。
//
// hook 側は hooks/useTrending.ts で React Query に乗せる。
// ============================================================

import { supabase } from '../supabase';
import { withApiTimeout } from '../withApiTimeout';
import { swallow } from '../swallow';

// ----------------------------------------------------------------
// get_trending_topics
// ----------------------------------------------------------------

/**
 * トレンドトピック 1 件。
 * - topic: 表示名 (tag / phrase / cluster の代表)
 * - post_count: 集計 window 内で topic が出現した投稿数
 * - score: ランキング用の合成スコア (recency + acceleration etc.)
 */
export type TrendingTopic = {
  topic: string;
  post_count: number;
  score: number;
};

/**
 * get_trending_topics RPC を呼び出してトレンドトピックを返す。
 *
 * @param windowHours 集計 window (時間単位, 既定 24)
 * @param limit       返却件数 (既定 10)
 *
 * error 時は `[]` を返す (Discovery タブのため止めない)。
 */
export async function getTrendingTopics(
  windowHours = 24,
  limit = 10,
): Promise<TrendingTopic[]> {
  try {
    const { data, error } = await withApiTimeout(
      supabase.rpc('get_trending_topics', {
        p_window_hours: windowHours,
        p_limit: limit,
      }),
      'search.getTrendingTopics',
      8000,
    );
    if (error) {
      swallow('search.getTrendingTopics', error);
      return [];
    }
    return (data ?? []) as TrendingTopic[];
  } catch (e) {
    swallow('search.getTrendingTopics.timeout', e);
    return [];
  }
}
