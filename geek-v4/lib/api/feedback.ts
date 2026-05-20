import { Platform } from 'react-native';
import { supabase } from '../supabase';

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

// 管理者用: 全件 + ユーザー情報まで取得
export type AdminFeedbackRow = FeedbackRow & {
  user_id: string | null;
  user_agent: string | null;
  screen_w: number | null;
  screen_h: number | null;
  nickname: string | null;
};

export async function fetchAllFeedback(
  filter?: { status?: FeedbackRow['status'] | 'all'; kind?: FeedbackKind | 'all' },
): Promise<AdminFeedbackRow[]> {
  // profiles への join は FK を明示しないと PGRST201 で全件落ちることがあるので
  // 明示 + フォールバック (nickname 抜きで再取得) で必ず一覧が表示されるようにする。
  const baseCols = 'id, user_id, kind, message, route, status, admin_notes, user_agent, screen_w, screen_h, created_at, updated_at';
  const buildQuery = (cols: string) => {
    let q = supabase.from('app_feedback').select(cols).order('created_at', { ascending: false }).limit(200);
    if (filter?.status && filter.status !== 'all') q = q.eq('status', filter.status);
    if (filter?.kind && filter.kind !== 'all') q = q.eq('kind', filter.kind);
    return q;
  };
  // 1st try: FK 明示で nickname も取る
  let res = await buildQuery(`${baseCols}, profiles!app_feedback_user_id_fkey(nickname)`);
  if (res.error) {
    // 2nd try: nickname 抜きで本体だけ取得
    console.warn('[fetchAllFeedback] nickname join failed, falling back:', res.error.message);
    res = await buildQuery(baseCols);
  }
  if (res.error) return [];
  const data = (res.data ?? []) as unknown as Record<string, unknown>[];
  return data.map((r) => {
    const p = r.profiles as { nickname?: string } | { nickname?: string }[] | null;
    const nickname = Array.isArray(p) ? p[0]?.nickname : p?.nickname;
    return {
      id: r.id as string,
      user_id: (r.user_id as string) ?? null,
      kind: r.kind as FeedbackKind,
      message: r.message as string,
      route: (r.route as string) ?? null,
      status: r.status as FeedbackRow['status'],
      admin_notes: (r.admin_notes as string) ?? null,
      user_agent: (r.user_agent as string) ?? null,
      screen_w: (r.screen_w as number) ?? null,
      screen_h: (r.screen_h as number) ?? null,
      created_at: r.created_at as string,
      updated_at: r.updated_at as string,
      nickname: nickname ?? null,
    };
  });
}

export async function updateFeedback(
  id: string,
  updates: { status?: FeedbackRow['status']; admin_notes?: string },
): Promise<void> {
  const { error } = await supabase
    .from('app_feedback')
    .update(updates)
    .eq('id', id);
  if (error) throw error;
}

// 自分が管理者か判定
export async function fetchIsAdmin(): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle();
  return !!(data as { is_admin?: boolean } | null)?.is_admin;
}
