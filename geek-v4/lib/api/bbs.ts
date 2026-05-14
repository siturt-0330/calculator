import { supabase } from '@/lib/supabase';
import type { BBSThread, BBSReply } from '@/types/models';

export async function fetchThreads(): Promise<BBSThread[]> {
  const { data, error } = await supabase
    .from('bbs_threads')
    .select('id, title, category, replies_count, last_reply_at, created_at')
    .order('last_reply_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as BBSThread[];
}

export async function createThread(title: string, category: string): Promise<BBSThread> {
  const { data, error } = await supabase
    .from('bbs_threads')
    .insert({ title, category })
    .select()
    .single();
  if (error) throw error;
  return data as BBSThread;
}

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
  const color = `hsl(${Math.floor(Math.random() * 360)}, 60%, 70%)`;
  const { error } = await supabase
    .from('bbs_replies')
    .insert({ thread_id: threadId, content, color });
  if (error) throw error;
}
