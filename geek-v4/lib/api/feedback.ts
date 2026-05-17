import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';

export type FeedbackKind = 'bug' | 'ui' | 'typo' | 'suggestion' | 'content' | 'other';

export type FeedbackRow = {
  id: string;
  kind: FeedbackKind;
  message: string;
  route: string | null;
  status: 'open' | 'triaged' | 'in_progress' | 'resolved' | 'wontfix';
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
};

export async function submitFeedback(input: {
  kind: FeedbackKind;
  message: string;
  route?: string;
}): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('ログインが必要です');

  let screenW: number | undefined;
  let screenH: number | undefined;
  let userAgent: string | undefined;
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    screenW = window.innerWidth;
    screenH = window.innerHeight;
    userAgent = navigator.userAgent;
  }

  const { error } = await supabase.from('app_feedback').insert({
    user_id: user.id,
    kind: input.kind,
    message: input.message.trim().slice(0, 2000),
    route: input.route ?? null,
    user_agent: userAgent ?? null,
    screen_w: screenW ?? null,
    screen_h: screenH ?? null,
  });
  if (error) throw error;
}

export async function fetchMyFeedback(): Promise<FeedbackRow[]> {
  const { data, error } = await supabase
    .from('app_feedback')
    .select('id, kind, message, route, status, admin_notes, created_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return [];
  return (data ?? []) as FeedbackRow[];
}
