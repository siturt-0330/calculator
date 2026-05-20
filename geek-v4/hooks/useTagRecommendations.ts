import { useMemo } from 'react';
import { recommendForTags, type RecommendResult } from '../lib/search/tagSearchV3';
import { useTagSearchV3 } from './useTagSearchV3';
import { useSearchClickStore } from '../stores/searchClickStore';

/**
 * シードタグ集合 (likedTags / blockedTags) から、
 * 次におすすめのタグを V3 エンジンで返す。
 *
 * すべてのシグナルを統合:
 *   - PMI 意味類似度 (共起埋め込みベース)
 *   - タググラフ 1-hop / 2-hop
 *   - 共起マトリクス
 *   - 人気度
 *   - トレンドブースト
 *   - CTR 学習
 *
 * 使い道:
 *   - 「これも好きでは？」(seedTags = likedTags)
 *   - 「これもブロック？」(seedTags = blockedTags)
 *   - タグ詳細ページの関連タグ
 */
export function useTagRecommendations(seedTags: string[], excludeTags: string[] = [], limit = 12): RecommendResult[] {
  const { ctx } = useTagSearchV3();
  const queryToTagCount = useSearchClickStore((s) => s.queryToTagCount);

  return useMemo(() => {
    if (seedTags.length === 0) return [];
    // クリック統計: シードタグ自身に対する CTR (例: "鬼滅" → クリックされたタグの集計)
    const clickBoosts: Record<string, number> = {};
    for (const seed of seedTags) {
      const norm = seed.trim().toLowerCase();
      const entry = queryToTagCount[norm];
      if (!entry) continue;
      for (const [tag, count] of Object.entries(entry)) {
        clickBoosts[tag] = (clickBoosts[tag] ?? 0) + count;
      }
    }
    const enhanced = { ...ctx, clickBoosts };
    return recommendForTags(seedTags, enhanced, excludeTags, { limit, diversify: true });
  }, [seedTags, excludeTags, limit, ctx, queryToTagCount]);
}
