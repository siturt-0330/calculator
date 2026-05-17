import { supabase } from '@/lib/supabase';
import type { Post } from '@/types/models';

export type SortMode = 'hot' | 'new' | 'top';

type FetchPostsOpts = {
  sort?: SortMode;
  likedTags: string[];
  blockedTags: string[];
  cursor?: string;
  limit?: number;
  filterTags?: string[];
};

export async function fetchPosts({
  sort = 'hot',
  blockedTags,
  cursor,
  limit = 20,
  filterTags,
}: FetchPostsOpts): Promise<{ posts: Post[]; nextCursor: string | null }> {
  let query = supabase
    .from('posts')
    .select('id, content, media_urls, media_blurhashes, tag_names, likes_count, comments_count, score, hot_score, concern_count, kind, source_url, is_public, trust_score_at_post, is_anonymous, created_at')
    .eq('is_anonymous', true)
    .eq('is_public', true)
    .limit(limit);

  if (blockedTags.length > 0) {
    query = query.not('tag_names', 'cs', `{${blockedTags.join(',')}}`);
  }

  if (filterTags && filterTags.length > 0) {
    query = query.overlaps('tag_names', filterTags);
  }

  if (sort === 'new') {
    query = query.order('created_at', { ascending: false });
    if (cursor) query = query.lt('created_at', cursor);
  } else if (sort === 'top') {
    query = query.order('likes_count', { ascending: false }).order('created_at', { ascending: false });
    if (cursor) {
      const [likesStr, ts] = cursor.split('|');
      const l = Number(likesStr ?? 0);
      query = query.or(`likes_count.lt.${l},and(likes_count.eq.${l},created_at.lt.${ts})`);
    }
  } else {
    // hot: いいね順 + 新しい順（時間制限なしで全件表示）
    query = query
      .order('likes_count', { ascending: false })
      .order('created_at', { ascending: false });
    if (cursor) {
      const [likesStr, ts] = cursor.split('|');
      const l = Number(likesStr ?? 0);
      query = query.or(`likes_count.lt.${l},and(likes_count.eq.${l},created_at.lt.${ts})`);
    }
  }

  const { data, error } = await query;
  if (error) throw error;

  const posts = (data ?? []) as Post[];
  let nextCursor: string | null = null;
  if (posts.length === limit) {
    const last = posts[posts.length - 1];
    if (last) {
      if (sort === 'new') nextCursor = last.created_at;
      else nextCursor = `${last.likes_count}|${last.created_at}`;
    }
  }
  return { posts, nextCursor };
}

export async function createPost({
  content,
  mediaUris,
  tagNames,
  isAnonymous,
  kind = 'opinion',
  sourceUrl,
  isPublic = true,
}: {
  content: string;
  mediaUris: string[];
  tagNames: string[];
  isAnonymous: boolean;
  kind?: 'fact' | 'opinion' | 'joke' | 'wip';
  sourceUrl?: string | null;
  isPublic?: boolean;
}): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { error } = await supabase.from('posts').insert({
    content,
    media_urls: mediaUris,
    media_blurhashes: [],
    tag_names: tagNames,
    is_anonymous: isAnonymous,
    author_id: user.id,
    kind,
    source_url: sourceUrl ?? null,
    is_public: isPublic,
  });
  if (error) throw error;
}

export async function fetchPostById(id: string): Promise<Post> {
  const { data, error } = await supabase
    .from('posts')
    .select('id, content, media_urls, media_blurhashes, tag_names, likes_count, comments_count, score, hot_score, concern_count, kind, source_url, is_public, trust_score_at_post, is_anonymous, created_at')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as Post;
}
