import { supabase } from '@/lib/supabase';
import type { BBSThread, BBSReply, Comment } from '@/types/models';

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
    .select('id, thread_id, content, color, created_at')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as BBSReply[];
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
    .select('id, post_id, content, avatar_color, created_at')
    .eq('post_id', postId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Comment[];
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
