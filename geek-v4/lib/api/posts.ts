import { supabase } from '@/lib/supabase';
import type { Post } from '@/types/models';

type FetchPostsOpts = {
  mode?: 'latest' | 'trend';
  likedTags: string[];
  blockedTags: string[];
  cursor?: string;
  limit?: number;
  filterTags?: string[];
};

export async function fetchPosts({
  mode = 'latest',
  likedTags,
  blockedTags,
  cursor,
  limit = 20,
  filterTags,
}: FetchPostsOpts): Promise<{ posts: Post[]; nextCursor: string | null }> {
  // user_id は SELECT しない（匿名性保護）
  let query = supabase
    .from('posts')
    .select('id, content, media_urls, media_blurhashes, tag_names, likes_count, comments_count, trust_score_at_post, is_anonymous, created_at')
    .eq('is_anonymous', true)
    .limit(limit);

  if (blockedTags.length > 0) {
    query = query.not('tag_names', 'cs', `{${blockedTags.join(',')}}`);
  }

  if (filterTags && filterTags.length > 0) {
    query = query.overlaps('tag_names', filterTags);
  }

  if (mode === 'trend') {
    query = query.order('likes_count', { ascending: false });
  } else {
    query = query.order('created_at', { ascending: false });
  }

  if (cursor) {
    query = query.lt('created_at', cursor);
  }

  const { data, error } = await query;
  if (error) throw error;

  const posts = (data ?? []) as Post[];
  const nextCursor = posts.length === limit ? (posts[posts.length - 1]?.created_at ?? null) : null;
  return { posts, nextCursor };
}

export async function createPost({
  content,
  mediaUris,
  tagNames,
  isAnonymous,
}: {
  content: string;
  mediaUris: string[];
  tagNames: string[];
  isAnonymous: boolean;
}): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { error } = await supabase.from('posts').insert({
    content,
    media_urls: mediaUris,
    media_blurhashes: [],
    tag_names: tagNames,
    is_anonymous: isAnonymous,
    user_id: user.id,
  });
  if (error) throw error;
}

export async function fetchPostById(id: string): Promise<Post> {
  const { data, error } = await supabase
    .from('posts')
    .select('id, content, media_urls, media_blurhashes, tag_names, likes_count, comments_count, trust_score_at_post, is_anonymous, created_at')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as Post;
}

export async function toggleLike(postId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: existing } = await supabase
    .from('likes')
    .select('id')
    .eq('post_id', postId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (existing) {
    await supabase.from('likes').delete().eq('id', existing.id);
  } else {
    await supabase.from('likes').insert({ post_id: postId, user_id: user.id });
  }
}
