import { useMemo } from 'react';
import { useTagSearchV3 } from './useTagSearchV3';
import { suggestTagsFromContent, type AutoTagSuggestion } from '../lib/search/autoTagFromContent';

/**
 * 投稿本文から自動的にタグ候補を提案するフック。
 * 内容が変わるたびに再計算 (debounce は呼び元で)。
 */
export function useAutoTagSuggest(content: string, excludeTags: string[] = [], limit = 8): AutoTagSuggestion[] {
  const { ctx } = useTagSearchV3();

  // 重い計算 (suggestTagsFromContent: 上位タグ × 本文のファジーマッチ + embeddings 走査)
  // は本文(content) と ctx が変わったときだけ実行する。除外タグ (excludeTags = 既に付与
  // 済みのタグ) は投稿中にタグを足すたびに変わるので、これを deps に入れると「1 タグ追加
  // ごとに重い計算が丸ごと再実行」されてカクついていた。除外は下の安いフィルタ段に分離。
  // フィルタで最大 excludeTags 件ぶん減るので、少し多め (limit + 6) に計算しておく。
  const raw = useMemo(() => {
    if (!content || content.length < 10) return [];
    const allTags = [...new Set([
      ...ctx.ngramIndex.getAllTags(),
      ...Object.keys(ctx.tagPopularity),
    ])];
    return suggestTagsFromContent(
      content,
      {
        allTags,
        nodes: ctx.nodes,
        cooccur: ctx.cooccur,
        tagPopularity: ctx.tagPopularity,
        embeddings: ctx.embeddings,
        trendingTags: ctx.trendingTags,
      },
      { limit: limit + 6 },
    );
  }, [content, limit, ctx]);

  // 除外フィルタ (安い)。タグ追加時はここだけ再実行される。
  return useMemo(() => {
    const exSet = new Set(excludeTags);
    return raw.filter((r) => !exSet.has(r.tag)).slice(0, limit);
  }, [raw, excludeTags, limit]);
}
