import { supabase } from '@/lib/supabase';
import type { BBSThread, BBSReply, Comment } from '@/types/models';
import { sanitizeContent } from '@/lib/sanitize';
import { checkRate, rateLimitMessage } from '@/lib/rateLimit';

export async function fetchThread(id: string): Promise<BBSThread | null> {
  if (!id) return null;
  // UUID 形式チェック (古い URL や壊れた ID への対策)
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(id)) return null;
  const { data, error } = await supabase
    .from('bbs_threads')
    .select('id, title, category, replies_count, last_reply_at, created_at')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    console.warn('[fetchThread] error:', error.message);
    throw error;
  }
  return data as BBSThread | null;
}

export async function fetchThreads(): Promise<BBSThread[]> {
  const { data, error } = await supabase
    .from('bbs_threads')
    .select('id, title, category, replies_count, last_reply_at, created_at')
    .order('last_reply_at', { ascending: false, nullsFirst: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as BBSThread[];
}

export async function createThread(title: string, category: string): Promise<BBSThread> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { data, error } = await supabase
    .from('bbs_threads')
    .insert({ title, category, author_id: user.id })
    .select('id, title, category, replies_count, last_reply_at, created_at')
    .single();
  if (error) throw error;
  return data as BBSThread;
}

// BBS スレッドへの返信
//
// 注: profiles への join は FK を明示する必要がある。
// bbs_replies → profiles のリレーションは複数経路あって PostgREST が PGRST201
// (Could not embed: multiple relationships) を返す:
//   1. bbs_replies.author_id → profiles.id (これが欲しい)
//   2. bbs_replies → bbs_reply_reactions → profiles (リアクション経由、欲しくない)
// よって明示的に `profiles!bbs_replies_author_id_fkey` と書く必要がある。
//
// もし将来 FK 名が変わったり、profiles 取得自体が RLS で弾かれた場合に
// スレッドが完全に見えなくなるのを防ぐため、author join 込みで失敗したら
// trust_score 抜きで再取得する 2 段構えにしてある。
export async function fetchReplies(threadId: string): Promise<BBSReply[]> {
  type RawReply = {
    id: string;
    thread_id: string;
    content: string;
    color: string;
    created_at: string;
    author?: { trust_score?: number } | { trust_score?: number }[] | null;
  };

  // 1st try: 著者の trust_score も一緒に取る (FK 明示)
  const withAuthor = await supabase
    .from('bbs_replies')
    .select('id, thread_id, content, color, created_at, author:profiles!bbs_replies_author_id_fkey(trust_score)')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true });

  if (!withAuthor.error) {
    return (withAuthor.data ?? []).map((r: RawReply) => {
      const a = Array.isArray(r.author) ? r.author[0] : r.author;
      return {
        id: r.id,
        thread_id: r.thread_id,
        content: r.content,
        color: r.color,
        created_at: r.created_at,
        trust_score: a?.trust_score ?? null,
      } as BBSReply;
    });
  }

  // 著者 join が失敗 → 返信本文だけは絶対に表示できるよう trust_score 抜きで再取得
  console.warn('[fetchReplies] author join failed, falling back without trust_score:', withAuthor.error.message);
  const fallback = await supabase
    .from('bbs_replies')
    .select('id, thread_id, content, color, created_at')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true });
  if (fallback.error) throw fallback.error;
  return (fallback.data ?? []).map((r) => ({
    id: r.id,
    thread_id: r.thread_id,
    content: r.content,
    color: r.color,
    created_at: r.created_at,
    trust_score: null,
  })) as BBSReply[];
}

export async function createReply(threadId: string, content: string): Promise<void> {
  const rl = checkRate('bbs_reply');
  if (!rl.ok) throw new Error(rateLimitMessage('bbs_reply', rl.retryAfterMs));
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const safeContent = sanitizeContent(content, { maxLength: 1000 });
  if (!safeContent) throw new Error('内容を入力してください');
  const color = `hsl(${Math.floor(Math.random() * 360)}, 60%, 70%)`;
  const { error } = await supabase
    .from('bbs_replies')
    .insert({ thread_id: threadId, content: safeContent, color, author_id: user.id });
  if (error) throw error;
}

// 投稿へのコメント（BBS返信とは別テーブル）
// fetchReplies と同じ PGRST201 リスクがあるので FK 明示 + フォールバック構成
export async function fetchComments(postId: string): Promise<Comment[]> {
  type RawComment = {
    id: string;
    post_id: string;
    content: string;
    avatar_color: string;
    created_at: string;
    author?: { trust_score?: number } | { trust_score?: number }[] | null;
  };

  const withAuthor = await supabase
    .from('comments')
    .select('id, post_id, content, avatar_color, created_at, author:profiles!comments_author_id_fkey(trust_score)')
    .eq('post_id', postId)
    .order('created_at', { ascending: true });

  if (!withAuthor.error) {
    return (withAuthor.data ?? []).map((c: RawComment) => {
      const a = Array.isArray(c.author) ? c.author[0] : c.author;
      return {
        id: c.id,
        post_id: c.post_id,
        content: c.content,
        avatar_color: c.avatar_color,
        created_at: c.created_at,
        trust_score: a?.trust_score ?? null,
      } as Comment;
    });
  }

  console.warn('[fetchComments] author join failed, falling back:', withAuthor.error.message);
  const fallback = await supabase
    .from('comments')
    .select('id, post_id, content, avatar_color, created_at')
    .eq('post_id', postId)
    .order('created_at', { ascending: true });
  if (fallback.error) throw fallback.error;
  return (fallback.data ?? []).map((c) => ({
    id: c.id,
    post_id: c.post_id,
    content: c.content,
    avatar_color: c.avatar_color,
    created_at: c.created_at,
    trust_score: null,
  })) as Comment[];
}

export async function createComment(postId: string, content: string): Promise<void> {
  const rl = checkRate('comment');
  if (!rl.ok) throw new Error(rateLimitMessage('comment', rl.retryAfterMs));
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const safeContent = sanitizeContent(content, { maxLength: 500 });
  if (!safeContent) throw new Error('内容を入力してください');
  const color = `hsl(${Math.floor(Math.random() * 360)}, 60%, 70%)`;
  const { error } = await supabase
    .from('comments')
    .insert({ post_id: postId, content: safeContent, avatar_color: color, author_id: user.id });
  if (error) throw error;
}
