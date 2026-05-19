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
    .select('id, content, media_urls, media_blurhashes, tag_names, likes_count, comments_count, score, hot_score, concern_count, kind, source_url, is_public, trust_score_at_post, is_anonymous, content_warning, cw_category, created_at')
    .eq('is_anonymous', true)
    .eq('is_public', true)
    .limit(limit);

  // PostgREST の URL 長さ制限 (≒8KB) 対策:
  // サーバー側で除外できるのは先頭 80 個まで。残りはクライアント側で smartSort
  // 経由で弾いている (lib/feed/smartRank.ts の blockedSet 判定)。
  // これで 92+ blocked tags でも URL が肥大化して 414 にならない。
  if (blockedTags.length > 0) {
    const SERVER_LIMIT = 80;
    const serverSide = blockedTags.length > SERVER_LIMIT
      ? blockedTags.slice(0, SERVER_LIMIT)
      : blockedTags;
    query = query.not('tag_names', 'cs', `{${serverSide.join(',')}}`);
  }

  if (filterTags && filterTags.length > 0) {
    query = query.overlaps('tag_names', filterTags);
  }

  // cursor 検証ヘルパ — 不正な cursor で偽 pagination が動くのを防ぐ
  // 期待フォーマット:
  //   new mode:        ISO timestamp (e.g. '2026-05-19T12:34:56.789Z')
  //   hot/top mode:    '<integer>|<ISO timestamp>'  e.g. '42|2026-05-19T12:34:56.789Z'
  const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
  function parseTimestampCursor(c: string): string | null {
    return ISO_RE.test(c) ? c : null;
  }
  function parseCompositeCursor(c: string): { likes: number; ts: string } | null {
    const parts = c.split('|');
    if (parts.length !== 2) return null;
    const likesStr = parts[0];
    const ts = parts[1];
    if (!likesStr || !ts) return null;
    // likes_count は正整数 (0 以上、INT4 上限以下)
    if (!/^\d{1,10}$/.test(likesStr)) return null;
    const likes = Number(likesStr);
    if (!Number.isFinite(likes) || likes < 0 || likes > 2147483647) return null;
    if (!ISO_RE.test(ts)) return null;
    return { likes, ts };
  }

  if (sort === 'new') {
    query = query.order('created_at', { ascending: false });
    if (cursor) {
      const validTs = parseTimestampCursor(cursor);
      if (validTs) query = query.lt('created_at', validTs);
      // 不正なら cursor を無視して先頭から (DoS 防止 — error throw だと無限リロード起こす)
    }
  } else if (sort === 'top') {
    query = query.order('likes_count', { ascending: false }).order('created_at', { ascending: false });
    if (cursor) {
      const parsed = parseCompositeCursor(cursor);
      if (parsed) {
        query = query.or(`likes_count.lt.${parsed.likes},and(likes_count.eq.${parsed.likes},created_at.lt.${parsed.ts})`);
      }
    }
  } else {
    // hot: いいね順 + 新しい順（時間制限なしで全件表示）
    query = query
      .order('likes_count', { ascending: false })
      .order('created_at', { ascending: false });
    if (cursor) {
      const parsed = parseCompositeCursor(cursor);
      if (parsed) {
        query = query.or(`likes_count.lt.${parsed.likes},and(likes_count.eq.${parsed.likes},created_at.lt.${parsed.ts})`);
      }
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

import { sanitizeContent, sanitizeTag, sanitizeUrl } from '@/lib/sanitize';
import { checkRate, rateLimitMessage } from '@/lib/rateLimit';

export async function createPost({
  content,
  mediaUris,
  tagNames,
  isAnonymous,
  kind = 'opinion',
  sourceUrl,
  isPublic = true,
  contentWarning = null,
  cwCategory = null,
  poll,
}: {
  content: string;
  mediaUris: string[];
  tagNames: string[];
  isAnonymous: boolean;
  kind?: 'fact' | 'opinion' | 'joke' | 'wip';
  sourceUrl?: string | null;
  isPublic?: boolean;
  contentWarning?: string | null;
  cwCategory?: 'spoiler' | 'nsfw' | 'violence' | 'sensitive' | null;
  poll?: { question: string; options: string[]; multiSelect?: boolean; expiresInHours?: number };
}): Promise<void> {
  // Rate limit (client-side, defense-in-depth)
  const rl = checkRate('post');
  if (!rl.ok) throw new Error(rateLimitMessage('post', rl.retryAfterMs));

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Sanitize 入力
  const safeContent = sanitizeContent(content, { maxLength: 2000 });
  const safeTags = tagNames.map(sanitizeTag).filter(Boolean);
  const safeSourceUrl = sourceUrl ? sanitizeUrl(sourceUrl) : null;
  const safeContentWarning = contentWarning ? sanitizeContent(contentWarning, { maxLength: 200 }) : null;

  const { data: post, error } = await supabase.from('posts').insert({
    content: safeContent,
    media_urls: mediaUris,
    media_blurhashes: [],
    tag_names: safeTags,
    is_anonymous: isAnonymous,
    author_id: user.id,
    kind,
    source_url: safeSourceUrl,
    is_public: isPublic,
    content_warning: safeContentWarning,
    cw_category: cwCategory,
  }).select('id').single();
  if (error) throw error;

  // Poll を作成
  if (poll && poll.options.filter((o) => o.trim()).length >= 2) {
    const expiresAt = poll.expiresInHours
      ? new Date(Date.now() + poll.expiresInHours * 3600 * 1000).toISOString()
      : null;
    const { data: pollRow, error: pollErr } = await supabase.from('polls').insert({
      post_id: (post as { id: string }).id,
      question: poll.question.trim(),
      expires_at: expiresAt,
      multi_select: !!poll.multiSelect,
    }).select('id').single();
    if (pollErr) throw pollErr;
    const opts = poll.options
      .map((label, i) => ({ poll_id: (pollRow as { id: string }).id, label: label.trim(), ordinal: i }))
      .filter((o) => o.label.length > 0);
    if (opts.length > 0) {
      await supabase.from('poll_options').insert(opts);
    }
  }
}

// UUID 形式チェック (壊れた URL や古い ID 対策)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function fetchPostById(id: string): Promise<Post | null> {
  if (!id || !UUID_RE.test(id)) return null;
  const { data, error } = await supabase
    .from('posts')
    .select('id, content, media_urls, media_blurhashes, tag_names, likes_count, comments_count, score, hot_score, concern_count, kind, source_url, is_public, trust_score_at_post, is_anonymous, content_warning, cw_category, created_at')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    // RLS で読めない場合や fetch エラー — 致命的ではないので null を返す
    console.warn('[fetchPostById] error:', error.message);
    return null;
  }
  return (data ?? null) as Post | null;
}
