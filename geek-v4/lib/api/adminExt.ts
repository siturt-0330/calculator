import { supabase } from '../supabase';

// ============================================================
// admin パネル拡張 API。
// admin.ts (基本 CRUD) と分離し、 0031_admin_moderation.sql で
// 導入された view / RPC / table 群を扱う。 RLS は base table 側 +
// is_admin() ヘルパで担保されるので client 側で service_role は
// 一切使わない。
//
// ★ 匿名性ハードニング (security/deanon-phase2):
//   posts.author_id を見る読みは 0128 の SECURITY DEFINER RPC
//   (admin_reported_posts, is_admin() gate) 経由に切り替える。0128 未適用の
//   本番/CI では isRpcMissing で従来の admin_reported_posts_v 直読に fallback する。
// ============================================================

// RPC がスキーマに無い (= 0128 未適用) ことを判定する (adminReports.ts と同形)。
function isRpcMissing(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  if (e.code === 'PGRST202') return true; // function not found in schema cache
  const msg = e.message ?? '';
  return /function .*does not exist|could not find the function/i.test(msg);
}

export type AdminReportedPost = {
  post_id: string;
  author_id: string;
  author_nickname: string | null;
  content: string;
  visibility: string;
  post_created_at: string;
  likes_count: number;
  concern_count: number;
  reports_count: number;
  last_reported_at: string;
};

export type AdminProblemUser = {
  id: string;
  nickname: string | null;
  account_state: string;
  trust_score: number;
  post_count: number;
  concern_received_count: number;
  flagged_posts_count: number;
  created_at: string;
};

export type AdminDashboardStats = {
  totalUsers: number;
  totalPosts: number;
  activeUsers24h: number;
  newPostsToday: number;
  suspendedUsers: number;
  openReports: number;
};

export type AdminModerationLogEntry = {
  id: string;
  admin_id: string;
  action: string;
  target_type: string;
  target_id: string;
  reason: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

// ============================================================
// 通報投稿
// ============================================================
// 0128 admin_reported_posts RPC を第一経路にする (author_id + nickname を definer
// 内で join 済で返すため、別途 profiles から nickname を引く round-trip が不要)。
// RPC 未適用 (PGRST202) のときだけ従来の admin_reported_posts_v 直読に fallback する。
export async function fetchReportedPosts(opts?: {
  minReports?: number;
  limit?: number;
  search?: string;
}): Promise<AdminReportedPost[]> {
  const min = opts?.minReports ?? 1;
  const limit = opts?.limit ?? 100;
  const search = opts?.search && opts.search.trim().length > 0 ? opts.search.trim() : null;

  const { data, error } = await supabase.rpc('admin_reported_posts', {
    p_min_reports: min,
    p_limit: limit,
    p_search: search,
  });
  if (error) {
    if (isRpcMissing(error)) return fetchReportedPostsFallback({ min, limit, search });
    throw error;
  }
  return (Array.isArray(data) ? data : []) as AdminReportedPost[];
}

// 0128 未適用環境向け: 旧 admin_reported_posts_v 直読 + nickname N+1 join。
async function fetchReportedPostsFallback(args: {
  min: number;
  limit: number;
  search: string | null;
}): Promise<AdminReportedPost[]> {
  let q = supabase
    .from('admin_reported_posts_v')
    .select(
      'post_id, author_id, content, visibility, post_created_at, likes_count, concern_count, reports_count, last_reported_at',
    )
    .gte('reports_count', args.min)
    .order('reports_count', { ascending: false })
    .order('last_reported_at', { ascending: false })
    .limit(args.limit);

  if (args.search) {
    q = q.ilike('content', `%${args.search}%`);
  }

  const { data, error } = await q;
  if (error) throw error;

  const rows = (data ?? []) as Array<{
    post_id: string;
    author_id: string;
    content: string;
    visibility: string;
    post_created_at: string;
    likes_count: number;
    concern_count: number;
    reports_count: number;
    last_reported_at: string;
  }>;
  if (rows.length === 0) return [];

  // author_id → nickname を 1 クエリでまとめて解決
  const authorIds = Array.from(new Set(rows.map((r) => r.author_id)));
  const nicknameMap = new Map<string, string>();
  if (authorIds.length > 0) {
    const { data: profiles, error: pErr } = await supabase
      .from('profiles')
      .select('id, nickname')
      .in('id', authorIds);
    if (!pErr && profiles) {
      for (const p of profiles as Array<{ id: string; nickname: string | null }>) {
        if (p.nickname) nicknameMap.set(p.id, p.nickname);
      }
    }
  }

  return rows.map((r) => ({
    ...r,
    author_nickname: nicknameMap.get(r.author_id) ?? null,
  }));
}

// ============================================================
// 問題ユーザー
// ============================================================
export async function fetchProblemUsers(opts?: {
  minConcerns?: number;
  limit?: number;
  sortBy?: 'concern' | 'trust' | 'recent';
}): Promise<AdminProblemUser[]> {
  const limit = opts?.limit ?? 100;
  const sortBy = opts?.sortBy ?? 'concern';

  let q = supabase
    .from('admin_problem_users_v')
    .select(
      'id, nickname, account_state, trust_score, post_count, concern_received_count, flagged_posts_count, created_at',
    )
    .limit(limit);

  if (opts?.minConcerns !== undefined) {
    q = q.gte('concern_received_count', opts.minConcerns);
  }

  if (sortBy === 'concern') {
    q = q.order('concern_received_count', { ascending: false });
  } else if (sortBy === 'trust') {
    q = q.order('trust_score', { ascending: true });
  } else {
    q = q.order('created_at', { ascending: false });
  }

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as AdminProblemUser[];
}

// ============================================================
// ダッシュボード集計
// ============================================================
export async function fetchAdminDashboardStats(): Promise<AdminDashboardStats> {
  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const sinceToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).toISOString();

  // 全部 head:true + count:'exact' で 1 行も転送せず件数だけ取得 (軽量)
  const [
    totalUsersRes,
    totalPostsRes,
    activeUsersRes,
    newPostsTodayRes,
    suspendedUsersRes,
    openReportsRes,
  ] = await Promise.all([
    supabase.from('profiles').select('id', { head: true, count: 'exact' }),
    supabase.from('posts').select('id', { head: true, count: 'exact' }),
    supabase
      .from('posts')
      .select('id', { head: true, count: 'exact' })
      .gte('created_at', since24h),
    supabase
      .from('posts')
      .select('id', { head: true, count: 'exact' })
      .gte('created_at', sinceToday),
    supabase
      .from('profiles')
      .select('id', { head: true, count: 'exact' })
      .eq('account_state', 'suspended'),
    supabase
      .from('admin_reported_posts_v')
      .select('post_id', { head: true, count: 'exact' })
      .gte('reports_count', 1),
  ]);

  return {
    totalUsers: totalUsersRes.count ?? 0,
    totalPosts: totalPostsRes.count ?? 0,
    activeUsers24h: activeUsersRes.count ?? 0,
    newPostsToday: newPostsTodayRes.count ?? 0,
    suspendedUsers: suspendedUsersRes.count ?? 0,
    openReports: openReportsRes.count ?? 0,
  };
}

// ============================================================
// 監査ログ
// ============================================================
export async function fetchModerationLog(opts?: {
  limit?: number;
}): Promise<AdminModerationLogEntry[]> {
  const limit = opts?.limit ?? 20;
  const { data, error } = await supabase
    .from('moderation_log')
    .select('id, admin_id, action, target_type, target_id, reason, metadata, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as AdminModerationLogEntry[];
}

// ============================================================
// 全投稿一括削除
// ============================================================
export async function deleteAllUserPosts(userId: string): Promise<{ deleted: number }> {
  const { data, error } = await supabase.rpc('admin_delete_all_user_posts', {
    p_user_id: userId,
  });
  if (error) throw error;
  return { deleted: (data as number | null) ?? 0 };
}

// ============================================================
// account_state リセット
// ============================================================
export async function resetAccountState(userId: string): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ account_state: 'healthy' })
    .eq('id', userId);
  if (error) throw error;

  // 監査ログ — 失敗しても呼び出し側は気にしない
  const { data: auth } = await supabase.auth.getUser();
  if (auth?.user) {
    await supabase.from('moderation_log').insert({
      admin_id: auth.user.id,
      action: 'reset_account_state',
      target_type: 'user',
      target_id: userId,
      reason: 'admin reset',
      metadata: {},
    });
  }
}

// ============================================================
// admin → ユーザー DM
// ============================================================
export async function sendAdminMessage(opts: {
  recipientId: string;
  title: string;
  body: string;
}): Promise<{ id: string }> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) throw new Error('not authenticated');

  const { data, error } = await supabase
    .from('admin_messages')
    .insert({
      recipient_id: opts.recipientId,
      sender_id: auth.user.id,
      title: opts.title,
      body: opts.body,
    })
    .select('id')
    .single();
  if (error) throw error;

  // 監査ログ — best-effort (失敗しても送信自体は成功扱い)
  const { error: logErr } = await supabase.from('moderation_log').insert({
    admin_id: auth.user.id,
    action: 'send_message',
    target_type: 'user',
    target_id: opts.recipientId,
    reason: opts.title,
    metadata: { message_id: (data as { id: string }).id },
  });
  if (logErr && __DEV__) {
    // eslint-disable-next-line no-console
    console.warn('[adminExt] audit log insert failed', logErr.message);
  }

  return { id: (data as { id: string }).id };
}
