import { supabase } from '../supabase';

// ============================================================
// 開発者 admin 専用 API。 RLS は 0025_admin_role.sql で
// is_admin=true な profile に対し profiles / posts / bbs_threads /
// communities への全権アクセスを許可する形で導入済み。
// client は自身の JWT を使うので service_role キーは露出しない。
//
// ★ 匿名性ハードニング (security/deanon-phase2):
//   将来 posts.author_id の列 SELECT を authenticated から REVOKE する。
//   admin も 'authenticated' なので直読は壊れる。そこで author_id を見る読み /
//   削除は 0128 の SECURITY DEFINER RPC (admin_reported_posts / admin_user_posts /
//   admin_post_detail / admin_delete_post, 全て is_admin() gate) 経由に切り替える。
//   0128 未適用の本番/CI では isRpcMissing で従来の直読経路に fallback する。
// ============================================================

// RPC がスキーマに無い (= 0128 未適用) ことを判定する (adminReports.ts と同形)。
function isRpcMissing(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  if (e.code === 'PGRST202') return true; // function not found in schema cache
  const msg = e.message ?? '';
  return /function .*does not exist|could not find the function/i.test(msg);
}

export type AdminUser = {
  id: string;
  nickname: string | null;
  account_state: string;
  trust_score: number;
  post_count: number;
  concern_received_count: number;
  is_admin: boolean;
  // 0061_shadowban で追加。 migration 適用前の env では undefined のまま動くよう optional に。
  shadowbanned?: boolean;
  created_at: string;
};

export type AdminPost = {
  id: string;
  author_id: string;
  author_nickname: string | null;
  content: string;
  visibility: string;
  likes_count: number;
  concern_count: number;
  created_at: string;
};

export async function fetchAllUsers(opts?: { search?: string; limit?: number }): Promise<AdminUser[]> {
  let q = supabase
    .from('profiles')
    .select('id, nickname, account_state, trust_score, post_count, concern_received_count, is_admin, shadowbanned, created_at')
    .order('created_at', { ascending: false })
    .limit(opts?.limit ?? 100);
  if (opts?.search && opts.search.trim().length > 0) {
    q = q.ilike('nickname', `%${opts.search.trim()}%`);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as AdminUser[];
}

export async function fetchAllPosts(opts?: { search?: string; limit?: number }): Promise<AdminPost[]> {
  // 0128 admin_all_posts RPC を第一経路にする (author_id + nickname を definer 内で
  // join 済で返すため、posts.author_id 直読 + nickname N+1 が不要)。
  // 未適用時のみ従来の 2 段階フェッチに fallback する。
  const limit = opts?.limit ?? 100;
  const search = opts?.search && opts.search.trim().length > 0 ? opts.search.trim() : null;

  const { data, error } = await supabase.rpc('admin_all_posts', {
    p_limit: limit,
    p_search: search,
  });
  if (error) {
    if (isRpcMissing(error)) return fetchAllPostsFallback({ limit, search });
    throw error;
  }
  return (Array.isArray(data) ? data : []) as AdminPost[];
}

// 0128 未適用環境向け: 旧 posts 直読 + profiles から nickname を N+1 join。
async function fetchAllPostsFallback(args: { limit: number; search: string | null }): Promise<AdminPost[]> {
  // posts.author_id の FK は auth.users(id) で profiles ではない為、
  // PostgREST の embed では取れない。 2 段階フェッチで nickname を join する。
  let q = supabase
    .from('posts')
    .select('id, author_id, content, visibility, likes_count, concern_count, created_at')
    .order('created_at', { ascending: false })
    .limit(args.limit);
  if (args.search) {
    q = q.ilike('content', `%${args.search}%`);
  }
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    id: string;
    author_id: string;
    content: string;
    visibility: string;
    likes_count: number;
    concern_count: number;
    created_at: string;
  }>;
  if (rows.length === 0) return [];

  // 著者 ID をユニーク化して 1 回でまとめて取得 (N+1 防止)
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

  return rows.map((p) => ({
    id: p.id,
    author_id: p.author_id,
    author_nickname: nicknameMap.get(p.author_id) ?? null,
    content: p.content,
    visibility: p.visibility,
    likes_count: p.likes_count,
    concern_count: p.concern_count,
    created_at: p.created_at,
  }));
}

// 引数は (id: string) のまま維持 — useMutation({ mutationFn: suspendUser }) の
// 直渡し互換のため (第2引数を足すと React Query の MutationFunctionContext と衝突する)。
// 操作理由は metadata の from→to で監査ログに残す。
export async function suspendUser(userId: string): Promise<void> {
  // before→after state を監査ログに残すため、変更前の account_state を先に取得。
  const { data: before } = await supabase
    .from('profiles').select('account_state').eq('id', userId).maybeSingle();
  const fromState = (before as { account_state?: string } | null)?.account_state ?? null;
  const { error } = await supabase.from('profiles').update({ account_state: 'suspended' }).eq('id', userId);
  if (error) throw error;
  await logModeration({
    action: 'suspend_user',
    target_type: 'user',
    target_id: userId,
    metadata: { from: fromState, to: 'suspended' },
  });
}

export async function unsuspendUser(userId: string): Promise<void> {
  const { data: before } = await supabase
    .from('profiles').select('account_state').eq('id', userId).maybeSingle();
  const fromState = (before as { account_state?: string } | null)?.account_state ?? null;
  const { error } = await supabase.from('profiles').update({ account_state: 'healthy' }).eq('id', userId);
  if (error) throw error;
  await logModeration({
    action: 'unsuspend_user',
    target_type: 'user',
    target_id: userId,
    metadata: { from: fromState, to: 'healthy' },
  });
}

export async function deletePost(postId: string): Promise<void> {
  // 0128 admin_delete_post RPC は author_id 読み・moderation_log 記録・削除を
  // definer 内で完結させるため、client は author_id を pre-read 不要。
  // 未適用時のみ従来の「pre-read author_id → delete → logModeration」に fallback する。
  const { error } = await supabase.rpc('admin_delete_post', { p_post_id: postId });
  if (error) {
    if (isRpcMissing(error)) return deletePostFallback(postId);
    throw error;
  }
}

// 0128 未適用環境向け: 旧 pre-read author_id → delete → logModeration。
async function deletePostFallback(postId: string): Promise<void> {
  // 削除前に author_id / visibility を取得して監査ログに残す (削除後は引けない)。
  const { data: before } = await supabase
    .from('posts').select('author_id, visibility').eq('id', postId).maybeSingle();
  const meta = before as { author_id?: string; visibility?: string } | null;
  const { error } = await supabase.from('posts').delete().eq('id', postId);
  if (error) throw error;
  await logModeration({
    action: 'delete_post',
    target_type: 'post',
    target_id: postId,
    metadata: { author_id: meta?.author_id ?? null, before_visibility: meta?.visibility ?? null },
  });
}

// ============================================================
// 拡張: モデレーション基盤 (0031_admin_moderation)
// ============================================================

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

export type ModerationLog = {
  id: string;
  admin_id: string;
  action: string;
  target_type: string;
  target_id: string;
  reason: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type AdminMessage = {
  id: string;
  recipient_id: string;
  sender_id: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
};

export type ConcernSummary = {
  user_id: string;
  post_id: string;
  reason: string;
  created_at: string;
};

// nickname を author_id の一覧から一括取得する小ヘルパ (N+1 防止)
async function fetchNicknameMap(authorIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (authorIds.length === 0) return map;
  const unique = Array.from(new Set(authorIds));
  const { data, error } = await supabase
    .from('profiles')
    .select('id, nickname')
    .in('id', unique);
  if (error || !data) return map;
  for (const p of data as Array<{ id: string; nickname: string | null }>) {
    if (p.nickname) map.set(p.id, p.nickname);
  }
  return map;
}

// ============================================================
// fetchReportedPosts — 報告数が閾値以上の投稿を取得
// ============================================================
// 0128 の admin_reported_posts RPC を第一経路にする (author_id + nickname を
// definer 内で join 済で返すため fetchNicknameMap の別ラウンドトリップが不要)。
// RPC 未適用 (PGRST202) のときだけ従来の admin_reported_posts_v 直読に fallback する。
export async function fetchReportedPosts(opts?: {
  minReports?: number;
  limit?: number;
  search?: string;
}): Promise<AdminReportedPost[]> {
  const minReports = opts?.minReports ?? 1;
  const limit = opts?.limit ?? 100;
  const search = opts?.search && opts.search.trim().length > 0 ? opts.search.trim() : null;

  const { data, error } = await supabase.rpc('admin_reported_posts', {
    p_min_reports: minReports,
    p_limit: limit,
    p_search: search,
  });
  if (error) {
    if (isRpcMissing(error)) return fetchReportedPostsFallback({ minReports, limit, search });
    throw error;
  }
  return (Array.isArray(data) ? data : []) as AdminReportedPost[];
}

// 0128 未適用環境向け: 旧 admin_reported_posts_v 直読 + nickname N+1 join。
async function fetchReportedPostsFallback(args: {
  minReports: number;
  limit: number;
  search: string | null;
}): Promise<AdminReportedPost[]> {
  let q = supabase
    .from('admin_reported_posts_v')
    .select('post_id, author_id, content, visibility, post_created_at, likes_count, concern_count, reports_count, last_reported_at')
    .gte('reports_count', args.minReports)
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
  const nicknameMap = await fetchNicknameMap(rows.map((r) => r.author_id));
  return rows.map((r) => ({
    post_id: r.post_id,
    author_id: r.author_id,
    author_nickname: nicknameMap.get(r.author_id) ?? null,
    content: r.content,
    visibility: r.visibility,
    post_created_at: r.post_created_at,
    likes_count: r.likes_count,
    concern_count: r.concern_count,
    reports_count: r.reports_count,
    last_reported_at: r.last_reported_at,
  }));
}

// ============================================================
// fetchProblemUsers — 報告を受けているか account_state が不健全なユーザーを取得
// ============================================================
export async function fetchProblemUsers(opts?: {
  minConcerns?: number;
  limit?: number;
  sortBy?: 'reports' | 'trust' | 'recent';
}): Promise<AdminProblemUser[]> {
  const minConcerns = opts?.minConcerns ?? 0;
  const limit = opts?.limit ?? 100;
  const sortBy = opts?.sortBy ?? 'reports';
  let q = supabase
    .from('admin_problem_users_v')
    .select('id, nickname, account_state, trust_score, post_count, concern_received_count, flagged_posts_count, created_at')
    .gte('concern_received_count', minConcerns)
    .limit(limit);
  if (sortBy === 'reports') q = q.order('concern_received_count', { ascending: false });
  else if (sortBy === 'trust') q = q.order('trust_score', { ascending: true });
  else q = q.order('created_at', { ascending: false });
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as AdminProblemUser[];
}

// ============================================================
// fetchUserDetail — ユーザー詳細 (基本情報 + 直近投稿 + 受報告 + モデ履歴 + DM)
// ============================================================
export async function fetchUserDetail(userId: string): Promise<{
  user: AdminUser;
  posts: AdminPost[];
  recentReports: ConcernSummary[];
  moderationHistory: ModerationLog[];
  messages: AdminMessage[];
}> {
  // 投稿は 0128 admin_user_posts RPC で取得 (author_id 列 SELECT に依存しない)。
  // 未適用時のみ posts 直読に fallback する。
  const [userRes, postRows, modRes, msgRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, nickname, account_state, trust_score, post_count, concern_received_count, is_admin, shadowbanned, created_at')
      .eq('id', userId)
      .single(),
    fetchUserPostRows(userId),
    supabase
      .from('moderation_log')
      .select('id, admin_id, action, target_type, target_id, reason, metadata, created_at')
      .eq('target_id', userId)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('admin_messages')
      .select('id, recipient_id, sender_id, title, body, read_at, created_at')
      .eq('recipient_id', userId)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  if (userRes.error) throw userRes.error;
  const user = userRes.data as AdminUser;

  const posts: AdminPost[] = postRows.map((p) => ({
    id: p.id,
    author_id: p.author_id,
    author_nickname: user.nickname,
    content: p.content,
    visibility: p.visibility,
    likes_count: p.likes_count,
    concern_count: p.concern_count,
    created_at: p.created_at,
  }));

  // 受報告 (concern) はこのユーザーの投稿に付いたものを集める。旧実装は
  // concerns.posts!inner(author_id) で embed-filter していたが、それは
  // posts.author_id 列 SELECT に依存する。上で得た post_id 集合で filter し直す
  // ことで author_id 列に触れずに同じ結果を得る。
  const postIds = postRows.map((p) => p.id);
  let recentReports: ConcernSummary[] = [];
  if (postIds.length > 0) {
    const { data: concernData, error: concernErr } = await supabase
      .from('concerns')
      .select('user_id, post_id, reason, created_at')
      .in('post_id', postIds)
      .order('created_at', { ascending: false })
      .limit(50);
    if (concernErr) throw concernErr;
    const concernRows = (concernData ?? []) as Array<{
      user_id: string;
      post_id: string;
      reason: string;
      created_at: string;
    }>;
    recentReports = concernRows.map((c) => ({
      user_id: c.user_id,
      post_id: c.post_id,
      reason: c.reason,
      created_at: c.created_at,
    }));
  }

  const moderationHistory = ((modRes.data ?? []) as ModerationLog[]);
  const messages = ((msgRes.data ?? []) as AdminMessage[]);

  return { user, posts, recentReports, moderationHistory, messages };
}

// 指定ユーザーの投稿行を取得。0128 admin_user_posts RPC を第一経路にし、
// 未適用時のみ posts 直読 (.eq('author_id')) に fallback する。
async function fetchUserPostRows(userId: string): Promise<Array<{
  id: string;
  author_id: string;
  content: string;
  visibility: string;
  likes_count: number;
  concern_count: number;
  created_at: string;
}>> {
  const { data, error } = await supabase.rpc('admin_user_posts', {
    p_user_id: userId,
    p_limit: 50,
  });
  if (error) {
    if (isRpcMissing(error)) {
      const { data: fb, error: fbErr } = await supabase
        .from('posts')
        .select('id, author_id, content, visibility, likes_count, concern_count, created_at')
        .eq('author_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (fbErr) throw fbErr;
      return (fb ?? []) as Array<{
        id: string;
        author_id: string;
        content: string;
        visibility: string;
        likes_count: number;
        concern_count: number;
        created_at: string;
      }>;
    }
    throw error;
  }
  return (Array.isArray(data) ? data : []) as Array<{
    id: string;
    author_id: string;
    content: string;
    visibility: string;
    likes_count: number;
    concern_count: number;
    created_at: string;
  }>;
}

// ============================================================
// fetchPostDetail — 投稿詳細 (投稿 + 報告者一覧 + モデ履歴)
// ============================================================
export async function fetchPostDetail(postId: string): Promise<{
  post: AdminPost;
  reporters: Array<{ user_id: string; nickname: string | null; created_at: string }>;
  moderationHistory: ModerationLog[];
}> {
  // post + reporters は 0128 admin_post_detail RPC で取得 (author_id 列 SELECT に
  // 依存しない)。moderation_log は author_id と無関係なので従来どおり直読する。
  const [detail, modRes] = await Promise.all([
    fetchPostDetailCore(postId),
    supabase
      .from('moderation_log')
      .select('id, admin_id, action, target_type, target_id, reason, metadata, created_at')
      .eq('target_id', postId)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  const moderationHistory = ((modRes.data ?? []) as ModerationLog[]);
  return { post: detail.post, reporters: detail.reporters, moderationHistory };
}

// post 本体 + reporters を取得。0128 admin_post_detail RPC を第一経路にし、
// 未適用時のみ posts/concerns 直読 + nickname N+1 join に fallback する。
async function fetchPostDetailCore(postId: string): Promise<{
  post: AdminPost;
  reporters: Array<{ user_id: string; nickname: string | null; created_at: string }>;
}> {
  const { data, error } = await supabase.rpc('admin_post_detail', { p_post_id: postId });
  if (error) {
    if (isRpcMissing(error)) return fetchPostDetailFallback(postId);
    throw error;
  }
  const payload = (data ?? null) as {
    post: {
      id: string;
      author_id: string;
      author_nickname: string | null;
      content: string;
      visibility: string;
      likes_count: number;
      concern_count: number;
      created_at: string;
    } | null;
    reporters: Array<{ user_id: string; nickname: string | null; created_at: string }> | null;
  } | null;
  if (!payload || !payload.post) throw new Error('post not found');
  const p = payload.post;
  const post: AdminPost = {
    id: p.id,
    author_id: p.author_id,
    author_nickname: p.author_nickname ?? null,
    content: p.content,
    visibility: p.visibility,
    likes_count: p.likes_count,
    concern_count: p.concern_count,
    created_at: p.created_at,
  };
  return { post, reporters: payload.reporters ?? [] };
}

// 0128 未適用環境向け: 旧 posts/concerns 直読 + nickname N+1 join。
async function fetchPostDetailFallback(postId: string): Promise<{
  post: AdminPost;
  reporters: Array<{ user_id: string; nickname: string | null; created_at: string }>;
}> {
  const [postRes, concernsRes] = await Promise.all([
    supabase
      .from('posts')
      .select('id, author_id, content, visibility, likes_count, concern_count, created_at')
      .eq('id', postId)
      .single(),
    supabase
      .from('concerns')
      .select('user_id, created_at')
      .eq('post_id', postId)
      .order('created_at', { ascending: false }),
  ]);

  if (postRes.error) throw postRes.error;
  const postRow = postRes.data as {
    id: string;
    author_id: string;
    content: string;
    visibility: string;
    likes_count: number;
    concern_count: number;
    created_at: string;
  };

  const concernRows = (concernsRes.data ?? []) as Array<{ user_id: string; created_at: string }>;
  const userIds = concernRows.map((c) => c.user_id);
  const nicknameMap = await fetchNicknameMap([...userIds, postRow.author_id]);

  const post: AdminPost = {
    id: postRow.id,
    author_id: postRow.author_id,
    author_nickname: nicknameMap.get(postRow.author_id) ?? null,
    content: postRow.content,
    visibility: postRow.visibility,
    likes_count: postRow.likes_count,
    concern_count: postRow.concern_count,
    created_at: postRow.created_at,
  };

  const reporters = concernRows.map((c) => ({
    user_id: c.user_id,
    nickname: nicknameMap.get(c.user_id) ?? null,
    created_at: c.created_at,
  }));

  return { post, reporters };
}

// ============================================================
// sendAdminMessage — admin → user の DM 送信
// ============================================================
export async function sendAdminMessage(args: {
  recipientId: string;
  title: string;
  body: string;
}): Promise<{ id: string }> {
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  const senderId = authData?.user?.id;
  if (!senderId) throw new Error('not authenticated');

  const { data, error } = await supabase
    .from('admin_messages')
    .insert({
      recipient_id: args.recipientId,
      sender_id: senderId,
      title: args.title,
      body: args.body,
    })
    .select('id')
    .single();
  if (error) throw error;
  const id = (data as { id: string }).id;
  await logModeration({
    action: 'send_message',
    target_type: 'user',
    target_id: args.recipientId,
    metadata: { message_id: id, title: args.title },
  });
  return { id };
}

// ============================================================
// deleteAllUserPosts — ユーザーの全投稿を一括削除 (RPC)
// ============================================================
export async function deleteAllUserPosts(
  userId: string,
  reason?: string,
): Promise<{ deleted: number }> {
  const { data, error } = await supabase.rpc('admin_delete_all_user_posts', { p_user_id: userId });
  if (error) throw error;
  const deleted = typeof data === 'number' ? data : 0;
  // RPC 側でも moderation_log に書いているが、reason を渡したい時用に
  // 追加で client 側からも一行残す (action=note)。
  if (reason && reason.length > 0) {
    await logModeration({
      action: 'note',
      target_type: 'user',
      target_id: userId,
      reason,
      metadata: { deleted },
    });
  }
  return { deleted };
}

// ============================================================
// logModeration — 全 mutation の監査ログ書き込みヘルパ
// ============================================================
export async function logModeration(args: {
  action:
    | 'suspend_user'
    | 'unsuspend_user'
    | 'delete_post'
    | 'delete_thread'
    | 'delete_comment'
    | 'send_message'
    | 'reset_account_state'
    | 'note';
  target_type: 'user' | 'post' | 'thread' | 'comment';
  target_id: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { data: authData } = await supabase.auth.getUser();
  const adminId = authData?.user?.id;
  if (!adminId) return; // 認証されていない時はサイレント (mutation 自体は RLS で弾かれる)
  const { error } = await supabase.from('moderation_log').insert({
    admin_id: adminId,
    action: args.action,
    target_type: args.target_type,
    target_id: args.target_id,
    reason: args.reason ?? '',
    metadata: args.metadata ?? {},
  });
  // 監査ログの失敗は本処理を止めない (best-effort)
  if (error && __DEV__) {
    // eslint-disable-next-line no-console
    console.warn('[admin] logModeration failed', error);
  }
}

// ============================================================
// resetAccountState — account_state を healthy / concern_received_count を 0 に
// ============================================================
export async function resetAccountState(userId: string): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ account_state: 'healthy', concern_received_count: 0 })
    .eq('id', userId);
  if (error) throw error;
  await logModeration({
    action: 'reset_account_state',
    target_type: 'user',
    target_id: userId,
  });
}

// ============================================================
// fetchModerationLog — 監査ログ閲覧
// ============================================================
export async function fetchModerationLog(opts?: {
  admin_id?: string;
  target_id?: string;
  limit?: number;
}): Promise<ModerationLog[]> {
  let q = supabase
    .from('moderation_log')
    .select('id, admin_id, action, target_type, target_id, reason, metadata, created_at')
    .order('created_at', { ascending: false })
    .limit(opts?.limit ?? 200);
  if (opts?.admin_id) q = q.eq('admin_id', opts.admin_id);
  if (opts?.target_id) q = q.eq('target_id', opts.target_id);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as ModerationLog[];
}

// ============================================================
// fetchAdminDashboardStats — ダッシュボード用集計
// ============================================================
export async function fetchAdminDashboardStats(): Promise<{
  totalUsers: number;
  totalPosts: number;
  activeUsers24h: number;
  newPostsToday: number;
  suspendedUsers: number;
  openReports: number;
}> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();

  const [totalUsersRes, totalPostsRes, activeUsersRes, newPostsRes, suspendedRes, reportsRes] =
    await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
      supabase.from('posts').select('id', { count: 'exact', head: true }),
      supabase
        .from('posts')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', since24h),
      supabase
        .from('posts')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', todayIso),
      supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('account_state', 'suspended'),
      supabase.from('concerns').select('post_id', { count: 'exact', head: true }),
    ]);

  return {
    totalUsers: totalUsersRes.count ?? 0,
    totalPosts: totalPostsRes.count ?? 0,
    activeUsers24h: activeUsersRes.count ?? 0,
    newPostsToday: newPostsRes.count ?? 0,
    suspendedUsers: suspendedRes.count ?? 0,
    openReports: reportsRes.count ?? 0,
  };
}

// ============================================================
// Shadowban API (0061_shadowban)
// ============================================================
// Reddit ガイド #10 / 6.9 章 — 「本人にだけ見える ban」。
// admin だけが trigger でき、RLS は posts/bbs_replies/comments の
// SELECT policy で「auth.uid()==author OR not shadowbanned」を強制する。
// API としては toggle + 検索 + 一覧の 3 つだけ提供。

/**
 * 指定ユーザーの shadowbanned フラグを切り替える。
 * - admin 以外が呼ぶと RPC 側で `admin only` で reject。
 * - 自分自身に対しては DB 側で `cannot shadowban yourself` で reject。
 * - 成功すると moderation_log に `shadowban` / `unshadowban` が best-effort で残る。
 */
export async function toggleShadowban(targetId: string, banned: boolean): Promise<void> {
  const { error } = await supabase.rpc('admin_toggle_shadowban', {
    target_id: targetId,
    banned,
  });
  if (error) throw error;
}

/**
 * ユーザー検索 (admin/users 画面の検索 input から呼ばれる)。
 * - email は profiles に同期されていない + RLS で auth.users を引けないため、
 *   nickname の ilike 検索のみ。空クエリの時は最新登録順を返す。
 * - 余計な情報を返さないよう AdminUser に絞って返す (shadowbanned 含む)。
 */
export async function searchUsers(query: string, limit = 20): Promise<AdminUser[]> {
  const trimmed = query.trim();
  let q = supabase
    .from('profiles')
    .select(
      'id, nickname, account_state, trust_score, post_count, concern_received_count, is_admin, shadowbanned, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));
  if (trimmed.length > 0) {
    // ilike は前方/部分一致いずれもサポート。% を含むユーザー入力は escape しないと
    // 余計な意味を持つので簡易 sanitize する (% と \ のみ)。
    const safe = trimmed.replace(/[\\%]/g, '\\$&');
    q = q.ilike('nickname', `%${safe}%`);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as AdminUser[];
}

/**
 * shadowbanned=true なユーザー一覧 (admin/users の「現在ban中」リスト表示用)。
 */
export async function fetchShadowbannedUsers(limit = 100): Promise<AdminUser[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select(
      'id, nickname, account_state, trust_score, post_count, concern_received_count, is_admin, shadowbanned, created_at',
    )
    .eq('shadowbanned', true)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 500));
  if (error) throw error;
  return (data ?? []) as AdminUser[];
}
