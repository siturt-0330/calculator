import { supabase } from '@/lib/supabase';
import type { Post } from '@/types/models';

// 与えられた post のタグ群から、共通タグを多く持つ他の投稿を取得
export async function fetchSimilarPosts(
  postId: string,
  tagNames: string[],
  limit = 6,
): Promise<Post[]> {
  if (!tagNames || tagNames.length === 0) return [];
  const SELECT = 'id, content, media_urls, media_blurhashes, tag_names, likes_count, comments_count, score, hot_score, concern_count, kind, source_url, is_public, trust_score_at_post, is_anonymous, content_warning, cw_category, created_at';
  const { data, error } = await supabase
    .from('posts')
    .select(SELECT)
    .overlaps('tag_names', tagNames)
    .neq('id', postId)
    .eq('is_anonymous', true)
    .eq('is_public', true)
    .order('created_at', { ascending: false })
    .limit(40);
  if (error || !data) return [];
  // クライアント側で「共通タグ数 × likes」でスコアリングして上位 K
  const tagSet = new Set(tagNames);
  return (data as Post[])
    .map((p) => {
      const overlap = (p.tag_names ?? []).filter((t) => tagSet.has(t)).length;
      const recencyH = (Date.now() - new Date(p.created_at).getTime()) / 3_600_000;
      const recency = Math.exp(-recencyH / 168);  // 1週間で半減
      const score = overlap * 10
        + Math.log(1 + (p.likes_count ?? 0)) * 2
        + recency * 5;
      return { post: p, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.post);
}
