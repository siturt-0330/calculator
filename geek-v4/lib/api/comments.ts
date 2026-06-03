// ============================================================
// lib/api/comments.ts — 投稿コメント (public.comments) の Supabase クエリ層
// ------------------------------------------------------------
// コメントツリー (migration 0059) の parent_comment_id / reply_to_comment_id に
// 加え、メディア添付 (migration 0104, comments.media_urls text[]) を扱う。
//
// - bbs.ts からの import は壊さないよう、bbs.ts 側で re-export している。
// - createComment は overload 互換のため第 3 引数 opts を optional に。
//   opts.parentId  → parent_comment_id (ツリー親)
//   opts.replyToId → reply_to_comment_id (メンション宛先 / 通知 trigger)
//   opts.mediaUrls → media_urls (添付メディアの公開 URL 配列)
// - SELECT は media 列が無い環境 (0104 未適用) でも壊れないよう段階 fallback。
// ============================================================

import { supabase } from '../supabase';
import { withApiTimeout } from '../withApiTimeout';
import type { Comment } from '../../types/models';
import { sanitizeContent } from '../sanitize';
import { checkRate, rateLimitMessage } from '../rateLimit';

// SELECT カラム — media 有 / 無 の 2 種類。列未適用環境では media 無し版で取る。
const COMMENT_SELECT_COLS_BASE =
  'id, post_id, author_id, content, avatar_color, created_at, parent_comment_id, reply_to_comment_id';
const COMMENT_SELECT_COLS_MEDIA = `${COMMENT_SELECT_COLS_BASE}, media_urls`;

type RawComment = {
  id: string;
  post_id: string;
  author_id: string;
  content: string;
  avatar_color: string;
  created_at: string;
  parent_comment_id: string | null;
  reply_to_comment_id: string | null;
  media_urls?: string[] | null;
  author?: { trust_score?: number } | { trust_score?: number }[] | null;
};

function mapRow(c: RawComment): Comment {
  const a = Array.isArray(c.author) ? c.author[0] : c.author;
  return {
    id: c.id,
    post_id: c.post_id,
    author_id: c.author_id,
    content: c.content,
    avatar_color: c.avatar_color,
    created_at: c.created_at,
    parent_comment_id: c.parent_comment_id,
    reply_to_comment_id: c.reply_to_comment_id,
    media_urls: Array.isArray(c.media_urls) ? c.media_urls : null,
    trust_score: a?.trust_score ?? null,
  } as Comment;
}

// DoS 防止: 1 post に対する comment は上限 500 件で打ち切り。
const FETCH_COMMENTS_LIMIT = 500;

// withApiTimeout は timeout 時に throw する ({error} を返さない)。tier cascade を壊さない
// よう、throw を既存の {data,error} フローへ正規化する小 helper。timeout は「その tier が
// 失敗した」と同義に扱い、次の tier へ fall-through させる (tier3 は呼び出し側で rethrow)。
async function safeRead<T>(
  p: PromiseLike<{ data: T | null; error: { message?: string } | null }>,
  label: string,
): Promise<{ data: T | null; error: { message?: string } | null }> {
  try {
    return await withApiTimeout(p, label, 8000);
  } catch (e) {
    return { data: null, error: e as { message?: string } };
  }
}

// 投稿へのコメント取得 — 3 段 fallback:
//   1) media + author(trust_score) join
//   2) media のみ (author join が PGRST201 で壊れた時も media は保つ)
//   3) base のみ (media_urls 列が無い = migration 0104 未適用 の環境)
// 各 tier を withApiTimeout(8s) で bound し、timeout も「その tier 失敗」として次へ流す。
export async function fetchComments(postId: string): Promise<Comment[]> {
  const t1 = await safeRead<RawComment[]>(
    supabase
      .from('comments')
      .select(`${COMMENT_SELECT_COLS_MEDIA}, author:profiles!comments_author_id_fkey(trust_score)`)
      .eq('post_id', postId)
      .order('created_at', { ascending: true })
      .limit(FETCH_COMMENTS_LIMIT),
    'comments.fetch.tier1',
  );
  if (!t1.error) return (t1.data ?? []).map((c: RawComment) => mapRow(c));

  console.warn('[fetchComments] tier1 (media+author) failed → media-only:', t1.error.message);
  const t2 = await safeRead<RawComment[]>(
    supabase
      .from('comments')
      .select(COMMENT_SELECT_COLS_MEDIA)
      .eq('post_id', postId)
      .order('created_at', { ascending: true })
      .limit(FETCH_COMMENTS_LIMIT),
    'comments.fetch.tier2',
  );
  if (!t2.error) return (t2.data ?? []).map((c: RawComment) => mapRow(c));

  console.warn('[fetchComments] tier2 (media) failed → base-only:', t2.error.message);
  const t3 = await safeRead<RawComment[]>(
    supabase
      .from('comments')
      .select(COMMENT_SELECT_COLS_BASE)
      .eq('post_id', postId)
      .order('created_at', { ascending: true })
      .limit(FETCH_COMMENTS_LIMIT),
    'comments.fetch.tier3',
  );
  if (t3.error) throw t3.error;
  return (t3.data ?? []).map((c: RawComment) => mapRow(c));
}

export type CreateCommentOpts = {
  parentId?: string | null;       // ツリー親 comment.id (なければ root として作る)
  replyToId?: string | null;       // メンション宛先 comment.id (notify trigger 起動)
  mediaUrls?: string[] | null;     // 添付メディアの公開 URL (migration 0104)
};

// 投稿への新規コメント。第 3 引数 opts は optional。
// メディアのみ (本文空) のコメントも migration 0104 適用後は許可する。
export async function createComment(
  postId: string,
  content: string,
  opts: CreateCommentOpts = {},
): Promise<void> {
  const rl = checkRate('comment');
  if (!rl.ok) throw new Error(rateLimitMessage('comment', rl.retryAfterMs));
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const safeContent = sanitizeContent(content, { maxLength: 1000 });
  const media = (opts.mediaUrls ?? []).filter(
    (u): u is string => typeof u === 'string' && u.length > 0,
  );
  // 本文・メディアどちらも無ければ拒否 (メディアのみコメントは許可)
  if (!safeContent && media.length === 0) throw new Error('内容を入力してください');
  const color = `hsl(${Math.floor(Math.random() * 360)}, 60%, 70%)`;

  const row: {
    post_id: string;
    content: string;
    avatar_color: string;
    author_id: string;
    parent_comment_id?: string | null;
    reply_to_comment_id?: string | null;
    media_urls?: string[];
  } = {
    post_id: postId,
    content: safeContent,
    avatar_color: color,
    author_id: user.id,
  };
  if (opts.parentId) row.parent_comment_id = opts.parentId;
  if (opts.replyToId) row.reply_to_comment_id = opts.replyToId;
  // media_urls は付与時のみ含める (列未適用環境で text コメントを壊さないため)
  if (media.length > 0) row.media_urls = media;

  const { error } = await supabase.from('comments').insert(row);
  if (error) throw error;
}
