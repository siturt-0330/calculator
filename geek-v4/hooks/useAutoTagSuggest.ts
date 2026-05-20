import { useMemo } from 'react';
import { useTagSearchV3 } from './useTagSearchV3';
import { suggestTagsFromContent, type AutoTagSuggestion } from '../lib/search/autoTagFromContent';

/**
 * 投稿本文から自動的にタグ候補を提案するフック。
 * 内容が変わるたびに再計算 (debounce は呼び元で)。
 */
export function useAutoTagSuggest(content: string, excludeTags: string[] = [], limit = 8): AutoTagSuggestion[] {
  const { ctx } = useTagSearchV3();
  return useMemo(() => {
    if (!content || content.length < 10) return [];
    const allTags = [...new Set([
      ...ctx.ngramIndex.getAllTags(),
      ...Object.keys(ctx.tagPopularity),
    ])];
    const result = suggestTagsFromContent(
      content,
      {
        allTags,
        nodes: ctx.nodes,
        cooccur: ctx.cooccur,
        tagPopularity: ctx.tagPopularity,
        embeddings: ctx.embeddings,
        trendingTags: ctx.trendingTags,
      },
      { limit },
    );
    // exclude フィルタ
    const exSet = new Set(excludeTags);
    return result.filter((r) => !exSet.has(r.tag));
  }, [content, excludeTags, limit, ctx]);
}
