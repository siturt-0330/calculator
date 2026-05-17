import { supabase } from '@/lib/supabase';
import type { BBSThread, BBSReply, Comment } from '@/types/models';

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
export async function fetchReplies(threadId: string): Promise<BBSReply[]> {
  const { data, error } = await supabase
    .from('bbs_replies')
    .select('id, thread_id, content, color, created_at, author:profiles(trust_score)')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  // author.trust_score を平坦化
  return (data ?? []).map((r: { id: string; thread_id: string; content: string; color: string; created_at: string; author?: { trust_score?: number } | { trust_score?: number }[] | null }) => {
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

export async function createReply(threadId: string, content: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const color = `hsl(${Math.floor(Math.random() * 360)}, 60%, 70%)`;
  const { error } = await supabase
    .from('bbs_replies')
    .insert({ thread_id: threadId, content, color, author_id: user.id });
  if (error) throw error;
}

// 投稿へのコメント（BBS返信とは別テーブル）
export async function fetchComments(postId: string): Promise<Comment[]> {
  const { data, error } = await supabase
    .from('comments')
    .select('id, post_id, content, avatar_color, created_at, author:profiles(trust_score)')
    .eq('post_id', postId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((c: { id: string; post_id: string; content: string; avatar_color: string; created_at: string; author?: { trust_score?: number } | { trust_score?: number }[] | null }) => {
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

export async function createComment(postId: string, content: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const color = `hsl(${Math.floor(Math.random() * 360)}, 60%, 70%)`;
  const { error } = await supabase
    .from('comments')
    .insert({ post_id: postId, content, avatar_color: color, author_id: user.id });
  if (error) throw error;
}
