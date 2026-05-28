// ============================================================
// lib/api/search.ts — Search v2 client API
// ------------------------------------------------------------
// backend RPC (C1 並列で実装中) への薄い wrapper。
//   - search_posts_v2: BM25 + recency + EEAT を server 側で算出
//   - get_trending_topics: 直近 N 時間の topic ランキング
//
// 既存の search 機構は lib/search/* (client-side) と
// lib/api/savedSearches.ts / lib/api/trending.ts (server-side) に分離されており、
// このファイルは「server RPC を直接叩く新経路」を担当する。
//
// 既存 export を破壊しないよう、追加のみ (このファイル自体は新規)。
// hook 側は hooks/useSearchV2.ts で React Query に乗せる。
// ============================================================

import { supabase } from '../supabase';
import { withApiTimeout } from '../withApiTimeout';
import { swallow } from '../swallow';

// ----------------------------------------------------------------
// search_posts_v2
// ----------------------------------------------------------------

/**
 * 1 投稿に対する検索 score の breakdown。
 * - final_score: 最終ランキング値 (UI 表示順)
 * - text_relevance: BM25 など本文一致度
 * - recency_boost: 投稿日時に基づくブースト
 * - eeat_score: 著者の Experience/Expertise/Authority/Trust 加点
 *
 * UI 上は final_score の降順で並べるだけで OK。
 * 内訳は debug / "なぜこの順位か" 表示に使える。
 */
export type SearchPostResult = {
  post_id: string;
  final_score: number;
  text_relevance: number;
  recency_boost: number;
  eeat_score: number;
};

export type SearchPostsV2Args = {
  /** ユーザーの検索クエリ (trim 前提、空文字は即 [] を返す) */
  query: string;
  /** 1 ページあたり件数 (既定 20) */
  limit?: number;
  /** offset-based pagination (既定 0) */
  offset?: number;
};

/**
 * search_posts_v2 RPC を呼び出して投稿の検索結果を返す。
 *
 * 空クエリは早期 return ([]) — RPC 呼ばずに済む。
 * error 時は `[]` を返し、Sentry breadcrumb に warning を残す
 * (search は失敗してもアプリは止めない方針 — UI 側は "0 件" 表示)。
 *
 * Network timeout は withApiTimeout で 8s に固定 (検索 UI は応答性最優先)。
 */
export async function searchPostsV2({
  query,
  limit = 20,
  offset = 0,
}: SearchPostsV2Args): Promise<SearchPostResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  try {
    const { data, error } = await withApiTimeout(
      supabase.rpc('search_posts_v2', {
        p_query: trimmed,
        p_limit: limit,
        p_offset: offset,
      }),
      'search.searchPostsV2',
      8000,
    );
    if (error) {
      swallow('search.searchPostsV2', error);
      return [];
    }
    return (data ?? []) as SearchPostResult[];
  } catch (e) {
    swallow('search.searchPostsV2.timeout', e);
    return [];
  }
}

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
