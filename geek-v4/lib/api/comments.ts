// ============================================================
// lib/api/comments.ts — 投稿コメント (public.comments) の Supabase クエリ層
// ------------------------------------------------------------
// 旧 lib/api/bbs.ts に同居していた fetchComments / createComment をここに
// 切り出し、コメントツリー (migration 0059) で追加された parent_comment_id /
// reply_to_comment_id を SELECT + INSERT で扱えるよう拡張する。
//
// - bbs.ts からの import は壊さないよう、bbs.ts 側で re-export している
//   (= 既存呼出 `import { fetchComments } from '../lib/api/bbs'` も維持される)。
// - createComment は overload 互換のため第 3 引数 opts を optional に。
//   opts.parentId  → parent_comment_id (ツリー親)
//   opts.replyToId → reply_to_comment_id (メンション宛先 / 通知 trigger)
// ============================================================

import { supabase } from '../supabase';
import type { Comment } from '../../types/models';
import { sanitizeContent } from '../sanitize';
import { checkRate, rateLimitMessage } from '../rateLimit';

// SELECT カラムは一箇所でメンテ — parent / reply_to を join 不要で取れるよう
// raw uuid のまま返す (クライアント側 buildCommentTree がツリー化する)。
const COMMENT_SELECT_COLS =
  'id, post_id, content, avatar_color, created_at, parent_comment_id, reply_to_comment_id';

type RawCommentWithAuthor = {
  id: string;
  post_id: string;
  content: string;
  avatar_color: string;
  created_at: string;
  parent_comment_id: string | null;
  reply_to_comment_id: string | null;
  author?: { trust_score?: number } | { trust_score?: number }[] | null;
};

type RawCommentNoAuthor = Omit<RawCommentWithAuthor, 'author'>;

// 投稿へのコメント取得 (FK 明示 + author join 失敗時 fallback)
// fetchReplies と同じ PGRST201 リスクがあるため 2 段構え:
//   1) profiles join で trust_score も付与
//   2) join 失敗 → trust_score 抜きで本文だけ確実に返す
export async function fetchComments(postId: string): Promise<Comment[]> {
  const withAuthor = await supabase
    .from('comments')
    .select(
      `${COMMENT_SELECT_COLS}, author:profiles!comments_author_id_fkey(trust_score)`,
    )
    .eq('post_id', postId)
    .order('created_at', { ascending: true });

  if (!withAuthor.error) {
    return (withAuthor.data ?? []).map((c: RawCommentWithAuthor) => {
      const a = Array.isArray(c.author) ? c.author[0] : c.author;
      return {
        id: c.id,
        post_id: c.post_id,
        content: c.content,
        avatar_color: c.avatar_color,
        created_at: c.created_at,
        parent_comment_id: c.parent_comment_id,
        reply_to_comment_id: c.reply_to_comment_id,
        trust_score: a?.trust_score ?? null,
      } as Comment;
    });
  }

  // 1st failed: trust_score 抜きでも本文は表示できるよう fallback
  console.warn(
    '[fetchComments] author join failed, falling back:',
    withAuthor.error.message,
  );
  const fallback = await supabase
    .from('comments')
    .select(COMMENT_SELECT_COLS)
    .eq('post_id', postId)
    .order('created_at', { ascending: true });
  if (fallback.error) throw fallback.error;
  return (fallback.data ?? []).map((c: RawCommentNoAuthor) => ({
    id: c.id,
    post_id: c.post_id,
    content: c.content,
    avatar_color: c.avatar_color,
    created_at: c.created_at,
    parent_comment_id: c.parent_comment_id,
    reply_to_comment_id: c.reply_to_comment_id,
    trust_score: null,
  })) as Comment[];
}

export type CreateCommentOpts = {
  parentId?: string | null;       // ツリー親 comment.id (なければ root として作る)
  replyToId?: string | null;       // メンション宛先 comment.id (notify trigger 起動)
};

// 投稿への新規コメント。第 3 引数 opts は optional — 既存呼出は壊れない。
// parent_comment_id は 4 段超で trigger によって NULL に矯正される (migration 0059)。
export async function createComment(
  postId: string,
  content: string,
  opts: CreateCommentOpts = {},
): Promise<void> {
  const rl = checkRate('comment');
  if (!rl.ok) throw new Error(rateLimitMessage('comment', rl.retryAfterMs));
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const safeContent = sanitizeContent(content, { maxLength: 500 });
  if (!safeContent) throw new Error('内容を入力してください');
  const color = `hsl(${Math.floor(Math.random() * 360)}, 60%, 70%)`;

  const row: {
    post_id: string;
    content: string;
    avatar_color: string;
    author_id: string;
    parent_comment_id?: string | null;
    reply_to_comment_id?: string | null;
  } = {
    post_id: postId,
    content: safeContent,
    avatar_color: color,
    author_id: user.id,
  };
  if (opts.parentId) row.parent_comment_id = opts.parentId;
  if (opts.replyToId) row.reply_to_comment_id = opts.replyToId;

  const { error } = await supabase.from('comments').insert(row);
  if (error) throw error;
}
