import { supabase } from '../supabase';
import type { Post, PostVisibility } from '../../types/models';

export type { PostVisibility } from '../../types/models';
export type SortMode = 'for-you' | 'hot' | 'new' | 'top';

// posts SELECT で取得するカラム一覧 (一箇所でメンテ可能)
// author_id は公式コミュ管理者投稿を de-anonymize する判定に使う (RLS で誰でも読める)
const POSTS_SELECT_COLS =
  'id, content, media_urls, media_blurhashes, tag_names, likes_count, comments_count, score, hot_score, concern_count, kind, source_url, is_public, trust_score_at_post, is_anonymous, content_warning, cw_category, visibility, created_at, author_id';

// UUID 形式チェック (壊れた URL や古い ID 対策) — fetchPostById と fetchCommunityPosts で使う
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type FetchPostsOpts = {
  sort?: SortMode;
  likedTags: string[];
  blockedTags: string[];
  cursor?: string;
  limit?: number;
  filterTags?: string[];
  // home フィード (default true) — visibility が 'public' / 'community_public' の post だけ表示
  // (private は本人以外、community_only はコミュニティ詳細でのみ)
  home?: boolean;
};

export async function fetchPosts({
  sort = 'hot',
  blockedTags,
  cursor,
  limit = 20,
  filterTags,
  home = true,
}: FetchPostsOpts): Promise<{ posts: Post[]; nextCursor: string | null }> {
  // 'for-you' は内部的に 'hot' と同じ広い候補プールを取りつつ、クライアント側で
  // パーソナライズ再ランクするので、候補数を 1.5x にしてランカー側に余白を与える。
  const isForYou = sort === 'for-you';
  const effectiveLimit = isForYou ? Math.ceil(limit * 1.5) : limit;
  const effectiveSort: 'hot' | 'new' | 'top' = isForYou ? 'hot' : sort;

  let query = supabase
    .from('posts')
    .select(POSTS_SELECT_COLS)
    .eq('is_anonymous', true)
    .eq('is_public', true)
    .limit(effectiveLimit);

  // ホームフィード: visibility が public / community_public のもののみ
  // (private は本人専用、community_only はコミュニティ詳細でしか出さない)
  // 既存 posts (visibility カラムが NULL の可能性ゼロ — default 'public' で backfill 済)
  if (home) {
    query = query.in('visibility', ['public', 'community_public']);
  }

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

  if (effectiveSort === 'new') {
    query = query.order('created_at', { ascending: false });
    if (cursor) {
      const validTs = parseTimestampCursor(cursor);
      if (validTs) query = query.lt('created_at', validTs);
      // 不正なら cursor を無視して先頭から (DoS 防止 — error throw だと無限リロード起こす)
    }
  } else if (effectiveSort === 'top') {
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
  if (posts.length === effectiveLimit) {
    const last = posts[posts.length - 1];
    if (last) {
      if (effectiveSort === 'new') nextCursor = last.created_at;
      else nextCursor = `${last.likes_count}|${last.created_at}`;
    }
  }
  const decorated = await attachOfficialAuthor(posts);
  return { posts: decorated, nextCursor };
}

import { sanitizeContent, sanitizeTag, sanitizeUrl } from '../sanitize';
import { checkRate, rateLimitMessage } from '../rateLimit';

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
  visibility = 'public',
  community_ids = [],
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
  // 4-way visibility (default 'public' — 既存挙動)
  visibility?: PostVisibility;
  // visibility が community_only / community_public の時に attach する community 一覧
  community_ids?: string[];
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
    visibility,
  }).select('id').single();
  if (error) throw error;

  const postId = (post as { id: string }).id;

  // community attach (post insert 成功後 — RLS が author を見るため順序が重要)
  // 重複排除 + 空文字弾き
  if (
    community_ids.length > 0 &&
    (visibility === 'community_only' || visibility === 'community_public')
  ) {
    const uniqueIds = Array.from(new Set(community_ids.filter((c) => c && c.length > 0)));
    if (uniqueIds.length > 0) {
      const rows = uniqueIds.map((community_id) => ({ post_id: postId, community_id }));
      const { error: attachErr } = await supabase.from('post_communities').insert(rows);
      if (attachErr) {
        // 致命的ではない (post 自体は成功) — ログだけ残してユーザーには知らせる
        console.warn('[createPost] community attach failed:', attachErr.message);
        throw new Error('コミュニティへの紐付けに失敗しました');
      }
    }
  }

  // Poll を作成
  if (poll && poll.options.filter((o) => o.trim()).length >= 2) {
    const expiresAt = poll.expiresInHours
      ? new Date(Date.now() + poll.expiresInHours * 3600 * 1000).toISOString()
      : null;
    const { data: pollRow, error: pollErr } = await supabase.from('polls').insert({
      post_id: postId,
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

// ============================================================
// 指定コミュニティの posts (visibility=community_only/community_public で attach されているもの)
// post_communities → posts の join + cursor pagination
// ============================================================
export async function fetchCommunityPosts({
  community_id,
  sort = 'new',
  cursor,
  limit = 30,
}: {
  community_id: string;
  sort?: SortMode;
  cursor?: string;
  limit?: number;
}): Promise<{ posts: Post[]; nextCursor: string | null }> {
  if (!community_id || !UUID_RE.test(community_id)) {
    return { posts: [], nextCursor: null };
  }

  // post_communities から post_id 一覧を取得 (新しい attach 順)
  // limit は 1 ページ分 — sort=hot/top の場合は post 側で並び替えるので余分に取らない
  let pcQuery = supabase
    .from('post_communities')
    .select('post_id, created_at')
    .eq('community_id', community_id)
    .order('created_at', { ascending: false })
    .limit(limit);

  // cursor (new sort 時のみ意味あり — attach 時刻)
  const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
  if (sort === 'new' && cursor && ISO_RE.test(cursor)) {
    pcQuery = pcQuery.lt('created_at', cursor);
  }

  const { data: pcRows, error: pcErr } = await pcQuery;
  if (pcErr) {
    console.warn('[fetchCommunityPosts] junction fetch failed:', pcErr.message);
    return { posts: [], nextCursor: null };
  }
  const rows = (pcRows ?? []) as { post_id: string; created_at: string }[];
  if (rows.length === 0) return { posts: [], nextCursor: null };

  const postIds = rows.map((r) => r.post_id);
  let postsQuery = supabase
    .from('posts')
    .select(POSTS_SELECT_COLS)
    .in('id', postIds);

  if (sort === 'top') {
    postsQuery = postsQuery
      .order('likes_count', { ascending: false })
      .order('created_at', { ascending: false });
  } else if (sort === 'hot') {
    postsQuery = postsQuery
      .order('likes_count', { ascending: false })
      .order('created_at', { ascending: false });
  } else {
    // new または for-you (for-you はクライアント側ランカー前提で時系列を渡す)
    postsQuery = postsQuery.order('created_at', { ascending: false });
  }

  const { data, error } = await postsQuery;
  if (error) {
    console.warn('[fetchCommunityPosts] posts fetch failed:', error.message);
    return { posts: [], nextCursor: null };
  }
  const posts = (data ?? []) as Post[];

  // nextCursor: new sort 時のみ attach 時刻ベースで返す
  let nextCursor: string | null = null;
  if (sort === 'new' && rows.length === limit) {
    const last = rows[rows.length - 1];
    if (last) nextCursor = last.created_at;
  }

  const decorated = await attachOfficialAuthor(posts);
  return { posts: decorated, nextCursor };
}

export async function fetchPostById(id: string): Promise<Post | null> {
  if (!id || !UUID_RE.test(id)) return null;
  const { data, error } = await supabase
    .from('posts')
    .select(POSTS_SELECT_COLS)
    .eq('id', id)
    .maybeSingle();
  if (error) {
    // RLS で読めない場合や fetch エラー — 致命的ではないので null を返す
    console.warn('[fetchPostById] error:', error.message);
    return null;
  }
  if (!data) return null;
  const [decorated] = await attachOfficialAuthor([data as Post]);
  return decorated ?? null;
}

// ============================================================
// 公式コミュ管理者投稿の de-anonymize
// ------------------------------------------------------------
// posts.author_id === communities.official_admin_user_id かつ
// is_official=true の community に紐付いている post には、実名 + 所属
// を派生フィールド official_author としてセットする。
// post → post_communities → communities を 1 リクエストで集約。
// 該当しない post は official_author = undefined のまま (anon 表示)。
// ============================================================
async function attachOfficialAuthor<T extends Post>(posts: T[]): Promise<T[]> {
  if (posts.length === 0) return posts;
  const postIds = posts.map((p) => p.id);
  const { data, error } = await supabase
    .from('post_communities')
    .select(
      'post_id, community:communities(is_official, official_admin_user_id, official_admin_display_name, official_organization)',
    )
    .in('post_id', postIds);
  if (error) {
    // 致命的ではない — 公式表示が出ないだけで anon 表示にフォールバック
    console.warn('[attachOfficialAuthor] join failed:', error.message);
    return posts;
  }
  type CommunityCol = {
    is_official?: boolean | null;
    official_admin_user_id?: string | null;
    official_admin_display_name?: string | null;
    official_organization?: string | null;
  };
  type Row = { post_id: string; community: CommunityCol | CommunityCol[] | null };
  const rows = (data ?? []) as unknown as Row[];
  // post_id → official admin info (最初に該当する公式コミュ管理者を採用)
  const officialByPostId: Record<string, { name: string; organization: string }> = {};
  for (const r of rows) {
    if (!r.community) continue;
    const c = Array.isArray(r.community) ? r.community[0] : r.community;
    if (!c || !c.is_official || !c.official_admin_user_id) continue;
    const post = posts.find((p) => p.id === r.post_id);
    if (!post || !post.author_id) continue;
    if (post.author_id !== c.official_admin_user_id) continue;
    officialByPostId[r.post_id] = {
      name: c.official_admin_display_name ?? '',
      organization: c.official_organization ?? '',
    };
  }
  return posts.map((p) => {
    const off = officialByPostId[p.id];
    if (!off) return p;
    return { ...p, official_author: off };
  });
}

// ============================================================
// 各 post に紐付いた community のメタ情報をまとめて取得
// post_communities junction → communities テーブルを 1 リクエストで join
// FlashList 上に大量 post があっても N+1 にならないよう .in() で集約。
// ============================================================
export type PostCommunityRef = {
  community_id: string;
  name: string;
  icon_emoji: string;
  icon_url: string | null;
  is_official?: boolean;
};

// post id 配列 → 各 post に紐付いた community のメタ情報を返す
// 1 リクエストで集約 (FlashList 上の大量 post でも軽い)
export async function fetchCommunitiesForPosts(
  postIds: string[],
): Promise<Record<string, PostCommunityRef[]>> {
  if (postIds.length === 0) return {};
  const { data, error } = await supabase
    .from('post_communities')
    .select('post_id, community:communities(id, name, icon_emoji, icon_url, is_official)')
    .in('post_id', postIds);
  if (error) {
    console.warn('[fetchCommunitiesForPosts] error:', error.message);
    return {};
  }
  // Supabase の typed return は join 関係を array で返す形 (FK の方向に依らず) なので
  // 単一でも複数でも安全に扱えるよう unknown 経由で narrow。
  // community が null (RLS で読めない / 削除済み) の行は無視。
  type CommunityCol = { id: string; name: string; icon_emoji: string; icon_url: string | null; is_official?: boolean };
  type Row = {
    post_id: string;
    community: CommunityCol | CommunityCol[] | null;
  };
  const rows = (data ?? []) as unknown as Row[];
  const grouped: Record<string, PostCommunityRef[]> = {};
  for (const r of rows) {
    if (!r.community) continue;
    const community = Array.isArray(r.community) ? r.community[0] : r.community;
    if (!community) continue;
    const arr = grouped[r.post_id] ?? [];
    arr.push({
      community_id: community.id,
      name: community.name,
      icon_emoji: community.icon_emoji,
      icon_url: community.icon_url,
      is_official: community.is_official ?? false,
    });
    grouped[r.post_id] = arr;
  }
  return grouped;
}
