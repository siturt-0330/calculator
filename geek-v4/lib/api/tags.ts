import { supabase } from '../supabase';
import { withApiTimeout } from '../withApiTimeout';
import { swallow } from '../swallow';
import { generateVariants } from '../search/variants';
import { similarityScore } from '../search/similarity';
import { deepNormalize } from '../search/tokenize';

export type PostAddedTag = {
  id: string;
  post_id: string;
  tag_name: string;
  added_by: string;
  created_at: string;
};

export type TagRelation = {
  id: string;
  tag_a: string;
  tag_b: string;
  relation_type: 'alias' | 'related';
  votes: number;
  created_at: string;
};

export type TagGroup = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
};

export type EventItem = {
  id: string;
  title: string;
  description: string | null;
  event_date: string;
  tag_name: string;
  location: string | null;
  created_at: string;
};

// alphabetical order でタグペアを正規化 (tag_relations の重複防止)。
// 例: canonicalize("b", "a") = ["a", "b"] / canonicalize("a", "a") は呼び出し側で reject。
// export して unit test 可能にする。
export function canonicalize(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

// ============ Post added tags ============

export async function fetchPostAddedTags(postId: string): Promise<PostAddedTag[]> {
  const { data, error } = await supabase
    .from('post_added_tags')
    .select('id, post_id, tag_name, added_by, created_at')
    .eq('post_id', postId)
    .order('created_at', { ascending: true })
    .limit(200); // 防御的上限 (1 post の追加タグは現実的に少数)
  if (error) throw error;
  return (data ?? []) as PostAddedTag[];
}

// 複数 post の added tags を一括取得 (フィード用)
export async function fetchAddedTagsForPosts(postIds: string[]): Promise<Record<string, string[]>> {
  if (postIds.length === 0) return {};
  // フィードの一部なので、network が詰まっても feed 全体を blocking しない
  // 6 秒で諦めて空 map を返す (UI 側でタグ無しで表示 → 次回 refetch で復帰)
  try {
    const { data, error } = await withApiTimeout(
      supabase
        .from('post_added_tags')
        .select('post_id, tag_name, created_at')
        .in('post_id', postIds)
        .order('created_at', { ascending: true }),
      'tags.addedForPosts',
      6000,
    );
    if (error) return {};
    const map: Record<string, string[]> = {};
    for (const r of (data ?? []) as Array<{ post_id: string; tag_name: string }>) {
      const arr = map[r.post_id] ?? (map[r.post_id] = []);
      if (!arr.includes(r.tag_name)) arr.push(r.tag_name);
    }
    return map;
  } catch {
    return {};
  }
}

export async function addPostTag(postId: string, tagName: string): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) throw new Error('Not authenticated');
  const tag = tagName.trim().replace(/^#/, '');
  if (!tag) throw new Error('Empty tag');
  const { error } = await supabase
    .from('post_added_tags')
    .insert({ post_id: postId, tag_name: tag, added_by: userId });
  if (error) throw error;
}

export async function removePostTag(postId: string, tagName: string): Promise<void> {
  const { error } = await supabase
    .from('post_added_tags')
    .delete()
    .eq('post_id', postId)
    .eq('tag_name', tagName);
  if (error) throw error;
}

// ============ Tag relations ============

export async function fetchTagRelations(tagName: string): Promise<TagRelation[]> {
  const { data, error } = await supabase
    .from('tag_relations')
    .select('id, tag_a, tag_b, relation_type, votes, created_at')
    .or(`tag_a.eq.${tagName},tag_b.eq.${tagName}`)
    .order('votes', { ascending: false })
    .limit(200); // 防御的上限 (1 タグの関連は現実的に少数)
  if (error) throw error;
  return (data ?? []) as TagRelation[];
}

export async function suggestTagRelation(
  tagA: string,
  tagB: string,
  relationType: 'alias' | 'related',
): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) throw new Error('Not authenticated');
  const a = tagA.trim().replace(/^#/, '');
  const b = tagB.trim().replace(/^#/, '');
  if (!a || !b || a === b) throw new Error('Invalid tags');
  const [tag_a, tag_b] = canonicalize(a, b);
  const { error } = await supabase
    .from('tag_relations')
    .insert({ tag_a, tag_b, relation_type: relationType, created_by: userId });
  if (error && !error.message.includes('duplicate')) throw error;
}

// ============ Tag groups ============

export async function fetchGroupsForTag(tagName: string): Promise<TagGroup[]> {
  const { data: members, error: memErr } = await supabase
    .from('tag_group_members')
    .select('group_id')
    .eq('tag_name', tagName);
  if (memErr) throw memErr;
  const ids = (members ?? []).map((m) => (m as { group_id: string }).group_id);
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('tag_groups')
    .select('id, name, description, created_at')
    .in('id', ids);
  if (error) throw error;
  return (data ?? []) as TagGroup[];
}

export async function fetchGroupMembers(groupId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('tag_group_members')
    .select('tag_name')
    .eq('group_id', groupId);
  if (error) throw error;
  return (data ?? []).map((d) => (d as { tag_name: string }).tag_name);
}

export async function createTagGroup(name: string, tagNames: string[]): Promise<string> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) throw new Error('Not authenticated');
  const { data, error } = await supabase
    .from('tag_groups')
    .insert({ name: name.trim(), created_by: userId })
    .select('id')
    .single();
  if (error) throw error;
  const groupId = (data as { id: string }).id;
  const rows = tagNames.map((t) => ({
    group_id: groupId,
    tag_name: t.trim().replace(/^#/, ''),
    added_by: userId,
  }));
  if (rows.length > 0) {
    const { error: memErr } = await supabase.from('tag_group_members').insert(rows);
    if (memErr) throw memErr;
  }
  return groupId;
}

export async function addTagToGroup(groupId: string, tagName: string): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) throw new Error('Not authenticated');
  const { error } = await supabase
    .from('tag_group_members')
    .insert({ group_id: groupId, tag_name: tagName.trim().replace(/^#/, ''), added_by: userId });
  if (error && !error.message.includes('duplicate')) throw error;
}

// ============ Events ============

export async function fetchEvents(tagFilter?: string[]): Promise<EventItem[]> {
  let q = supabase
    .from('events')
    .select('id, title, description, event_date, tag_name, location, created_at')
    .gte('event_date', new Date().toISOString().slice(0, 10))
    .order('event_date', { ascending: true })
    .limit(50);
  if (tagFilter && tagFilter.length > 0) {
    q = q.in('tag_name', tagFilter);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as EventItem[];
}

// ============ Tag search / autocomplete (表記ゆれ込み) ============
// コミュニティ作成・投稿作成のタグ補完が共通で使う「既存タグ検索」。
// generateVariants(ローマ字 / かな / 同義語)を OR ilike で broad fetch し、
// 完全一致 > 前方一致 > similarity + post_count で client 再ランキングして返す。
// 背景: community/create が生の `.ilike('%q%')` を使い表記ゆれを拾えず
// 「既存タグが出ず新規作成ばかり」に見えていた問題の解消。searchByName /
// searchCommunities と同じ broad-fetch + rerank 戦略に統一する。

export type TagSuggestion = { name: string; post_count: number };

// Supabase ilike / PostgREST or() の特殊文字を無害化 (communities.ts と同等)。
function escapeForIlikeTag(raw: string): string {
  let s = raw.replace(/[\\%_]/g, '\\$&');
  s = s.replace(/[(),]/g, ' ').replace(/\s+/g, ' ').trim();
  return s;
}

export async function searchTags(
  query: string,
  opts: { limit?: number; excludeTags?: string[] } = {},
): Promise<TagSuggestion[]> {
  const q = query.trim().replace(/^#/, '');
  if (q.length < 1) return [];
  const limit = opts.limit ?? 8;
  const excludeSet = new Set((opts.excludeTags ?? []).map((t) => deepNormalize(t)));

  const variants = generateVariants(q).slice(0, 6);
  const esc = variants.map((v) => escapeForIlikeTag(v)).filter((v) => v.length > 0);
  if (esc.length === 0) return [];

  try {
    const orQuery = esc.map((v) => `name.ilike.%${v}%`).join(',');
    const { data, error } = await withApiTimeout(
      supabase
        .from('tags')
        .select('name, post_count')
        .or(orQuery)
        .order('post_count', { ascending: false })
        .limit(60),
      'tags.searchTags',
      8000,
    );
    if (error) {
      swallow('tags.searchTags', error);
      return [];
    }
    const rows = (data ?? []) as TagSuggestion[];
    const nq = deepNormalize(q);
    const scored = rows
      .filter((r) => !excludeSet.has(deepNormalize(r.name)))
      .map((r) => {
        const dn = deepNormalize(r.name);
        // 完全一致 > 前方一致 > 類似度。タイブレークに post_count を弱く混ぜる。
        let rel = similarityScore(q, r.name);
        if (dn === nq) rel = 1;
        else if (nq.length >= 1 && (dn.startsWith(nq) || nq.startsWith(dn))) {
          rel = Math.max(rel, 0.85);
        }
        const pop = Math.log10((r.post_count ?? 0) + 1) / 10; // 0..~0.x の弱い加点
        return { r, score: rel + pop };
      })
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.r);
  } catch (e) {
    swallow('tags.searchTags', e);
    return [];
  }
}
