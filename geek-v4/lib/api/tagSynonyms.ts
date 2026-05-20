import { supabase } from '../supabase';

export type TagSynonym = {
  synonym: string;
  vote_count: number;
  is_confirmed: boolean;
};

// 「ある タグ」 の synonym 候補一覧を取得 (mv_tag_synonyms から)
export async function fetchTagSynonyms(tag: string): Promise<TagSynonym[]> {
  const { data, error } = await supabase.rpc('get_tag_synonyms', { p_tag: tag });
  if (error) {
    console.warn('[tagSynonyms] fetch failed:', error.message);
    return [];
  }
  return (data ?? []) as TagSynonym[];
}

// 「タグ A と B は同じ意味」 と投票
export async function voteTagSynonym(a: string, b: string): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('vote_tag_synonym', { p_a: a, p_b: b });
  if (error) return { error: error.message };
  return { error: null };
}
