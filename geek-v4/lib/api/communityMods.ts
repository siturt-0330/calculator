// ============================================================
// lib/api/communityMods.ts — コミュニティ管理人 (mod) API ラッパ
// ============================================================
// migration 0068 で導入した mod 機能の Supabase アクセス層。
//
// 権限:
//   - 各 RPC / RLS で is_community_mod(community_id) = owner or admin が
//     担保されている。ここでは client 側のエラーハンドリングと
//     型整形のみ行う。
//
// 規約 (CLAUDE.md § 5.1):
//   - supabase 呼び出しは withApiTimeout でラップ (mutation はリトライしない)
//   - エラーは throw new Error(...) で上位 (React Query mutation) に伝播
//   - DELETE 操作は SELECT count を返さない (Supabase の delete は影響行数を
//     返さない仕様) — 「成功 = 例外なし」と扱う。
// ============================================================

import { supabase } from '../supabase';
import { withApiTimeout } from '../withApiTimeout';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, label: string): void {
  if (!UUID_RE.test(value)) {
    throw new Error(`${label} は UUID 形式である必要があります`);
  }
}

// ============================================================
// 型定義
// ============================================================

export type MemberRole = 'owner' | 'admin' | 'member';

export type MemberWithProfile = {
  community_id: string;
  user_id: string;
  role: MemberRole;
  joined_at: string;
  // profiles から join (RLS 上 profiles は全 read 可だが nickname/avatar のみ)
  profile: {
    id: string;
    nickname: string | null;
    avatar_url: string | null;
    avatar_emoji: string | null;
  } | null;
};

export type BanWithProfile = {
  community_id: string;
  user_id: string;
  banned_by: string;
  reason: string | null;
  banned_at: string;
  profile: {
    id: string;
    nickname: string | null;
    avatar_url: string | null;
    avatar_emoji: string | null;
  } | null;
};

export type ModAction =
  | 'delete_post'
  | 'delete_comment'
  | 'delete_bbs_reply'
  | 'kick'
  | 'ban'
  | 'unban'
  | 'promote'
  | 'demote';

export type ModActionLog = {
  id: string;
  community_id: string;
  mod_user_id: string;
  target_user_id: string | null;
  target_post_id: string | null;
  target_comment_id: string | null;
  target_bbs_reply_id: string | null;
  action: ModAction;
  reason: string | null;
  created_at: string;
};

// ============================================================
// 内部: profile 一括取得 (member / ban 行に attach 用)
// ============================================================
type ProfileRow = {
  id: string;
  nickname: string | null;
  avatar_url: string | null;
  avatar_emoji: string | null;
};

async function fetchProfilesById(ids: string[]): Promise<Map<string, ProfileRow>> {
  const map = new Map<string, ProfileRow>();
  if (ids.length === 0) return map;
  const unique = Array.from(new Set(ids));
  const { data, error } = await withApiTimeout(
    supabase
      .from('profiles')
      .select('id, nickname, avatar_url, avatar_emoji')
      .in('id', unique),
    'communityMods.fetchProfilesById',
    8000,
  );
  if (error) {
    console.warn('[communityMods] fetchProfilesById failed:', error.message);
    return map;
  }
  for (const row of (data ?? []) as ProfileRow[]) map.set(row.id, row);
  return map;
}

// ============================================================
// 一覧系 (mod 管理画面の table 表示用)
// ============================================================

// メンバー一覧 (owner → admin → member の順 + joined_at desc) を返す。
// RLS で「open / member の場合は誰でも見える」が担保されている。mod 画面用なので
// caller 側 (UI) は role が owner/admin だけを見せる切り替えをするが、API としては
// 全 role を返す (キック対象は member だけ等の制御は UI で)。
export async function fetchCommunityMembers(
  communityId: string,
): Promise<MemberWithProfile[]> {
  assertUuid(communityId, 'communityId');

  const { data, error } = await withApiTimeout(
    supabase
      .from('community_members')
      .select('community_id, user_id, role, joined_at')
      .eq('community_id', communityId)
      .order('joined_at', { ascending: false }),
    'communityMods.fetchCommunityMembers',
    8000,
  );
  if (error) {
    console.warn('[communityMods] fetchCommunityMembers failed:', error.message);
    throw new Error(`メンバー一覧の取得に失敗しました: ${error.message}`);
  }
  type Row = { community_id: string; user_id: string; role: MemberRole; joined_at: string };
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return [];

  const profileMap = await fetchProfilesById(rows.map((r) => r.user_id));
  const ROLE_RANK: Record<MemberRole, number> = { owner: 0, admin: 1, member: 2 };
  const out = rows.map<MemberWithProfile>((r) => ({
    community_id: r.community_id,
    user_id: r.user_id,
    role: r.role,
    joined_at: r.joined_at,
    profile: profileMap.get(r.user_id) ?? null,
  }));
  // role 優先 → 同じ role 内では joined_at desc を維持
  out.sort((a, b) => {
    const r = ROLE_RANK[a.role] - ROLE_RANK[b.role];
    if (r !== 0) return r;
    return a.joined_at < b.joined_at ? 1 : a.joined_at > b.joined_at ? -1 : 0;
  });
  return out;
}

// BAN リスト (mod のみ閲覧可能 — RLS で担保)
export async function fetchCommunityBans(
  communityId: string,
): Promise<BanWithProfile[]> {
  assertUuid(communityId, 'communityId');

  const { data, error } = await withApiTimeout(
    supabase
      .from('community_bans')
      .select('community_id, user_id, banned_by, reason, banned_at')
      .eq('community_id', communityId)
      .order('banned_at', { ascending: false }),
    'communityMods.fetchCommunityBans',
    8000,
  );
  if (error) {
    console.warn('[communityMods] fetchCommunityBans failed:', error.message);
    throw new Error(`BAN 一覧の取得に失敗しました: ${error.message}`);
  }
  type Row = {
    community_id: string;
    user_id: string;
    banned_by: string;
    reason: string | null;
    banned_at: string;
  };
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return [];

  const profileMap = await fetchProfilesById(rows.map((r) => r.user_id));
  return rows.map<BanWithProfile>((r) => ({
    ...r,
    profile: profileMap.get(r.user_id) ?? null,
  }));
}

// mod_action_logs (audit log) を新しい順で返す。
// limit は UI のページング初期表示用 (default 50)。
export async function fetchModActionLogs(
  communityId: string,
  limit: number = 50,
): Promise<ModActionLog[]> {
  assertUuid(communityId, 'communityId');
  const safeLimit = Math.max(1, Math.min(limit, 200));

  const { data, error } = await withApiTimeout(
    supabase
      .from('mod_action_logs')
      .select(
        'id, community_id, mod_user_id, target_user_id, target_post_id, target_comment_id, target_bbs_reply_id, action, reason, created_at',
      )
      .eq('community_id', communityId)
      .order('created_at', { ascending: false })
      .limit(safeLimit),
    'communityMods.fetchModActionLogs',
    8000,
  );
  if (error) {
    console.warn('[communityMods] fetchModActionLogs failed:', error.message);
    throw new Error(`操作履歴の取得に失敗しました: ${error.message}`);
  }
  return (data ?? []) as ModActionLog[];
}

// ============================================================
// メンバー管理 (kick / ban / unban) — RPC 経由
// ============================================================

// 単純キック (再参加可)。RPC 内で mod チェック + 自分は kick できない guard あり。
export async function kickMember(
  communityId: string,
  userId: string,
  reason?: string,
): Promise<void> {
  assertUuid(communityId, 'communityId');
  assertUuid(userId, 'userId');

  const { error } = await withApiTimeout(
    supabase.rpc('mod_kick_member', {
      target_community_id: communityId,
      target_user_id: userId,
      reason: reason ?? null,
    }),
    'communityMods.kickMember',
    8000,
  );
  if (error) {
    throw new Error(`メンバーのキックに失敗しました: ${error.message}`);
  }
}

// BAN (kick + 再参加禁止)。
export async function banMember(
  communityId: string,
  userId: string,
  reason?: string,
): Promise<void> {
  assertUuid(communityId, 'communityId');
  assertUuid(userId, 'userId');

  const { error } = await withApiTimeout(
    supabase.rpc('mod_ban_member', {
      target_community_id: communityId,
      target_user_id: userId,
      reason: reason ?? null,
    }),
    'communityMods.banMember',
    8000,
  );
  if (error) {
    throw new Error(`メンバーの BAN に失敗しました: ${error.message}`);
  }
}

// BAN 解除。member には自動で戻らない (再 join は本人主導)。
export async function unbanMember(
  communityId: string,
  userId: string,
): Promise<void> {
  assertUuid(communityId, 'communityId');
  assertUuid(userId, 'userId');

  const { error } = await withApiTimeout(
    supabase.rpc('mod_unban_member', {
      target_community_id: communityId,
      target_user_id: userId,
    }),
    'communityMods.unbanMember',
    8000,
  );
  if (error) {
    throw new Error(`BAN 解除に失敗しました: ${error.message}`);
  }
}

// ============================================================
// 投稿 / コメント / 返信 の mod 削除
// ============================================================
// RLS の posts_delete / comments_delete / bbs_replies_delete に mod 経路が
// 追加されているので、通常の DELETE で削除できる。
// log は別 INSERT で残す (RLS で mod のみ書き込み可)。
// log INSERT が失敗しても削除自体は成功扱い (silent — Sentry に breadcrumb)。
// ============================================================

async function fetchPostCommunityId(postId: string): Promise<string | null> {
  // 1 ポストが複数 community に attach されている可能性があるが、
  // log には「どこの community で削除したか」を 1 つだけ残す。
  // 自分が mod になっている community のいずれかを優先したいが、
  // 取得簡略化のため最初に見つかった community_id を採用する。
  const { data, error } = await withApiTimeout(
    supabase
      .from('post_communities')
      .select('community_id')
      .eq('post_id', postId)
      .limit(1)
      .maybeSingle(),
    'communityMods.fetchPostCommunityId',
    8000,
  );
  if (error) return null;
  return ((data?.community_id as string | undefined) ?? null);
}

async function fetchCommentPostId(commentId: string): Promise<string | null> {
  const { data, error } = await withApiTimeout(
    supabase
      .from('comments')
      .select('post_id')
      .eq('id', commentId)
      .maybeSingle(),
    'communityMods.fetchCommentPostId',
    8000,
  );
  if (error || !data) return null;
  return (data.post_id as string | undefined) ?? null;
}

async function fetchBBSReplyCommunityId(replyId: string): Promise<string | null> {
  const { data, error } = await withApiTimeout(
    supabase
      .from('bbs_replies')
      .select('thread_id, bbs_threads!inner(community_id)')
      .eq('id', replyId)
      .maybeSingle(),
    'communityMods.fetchBBSReplyCommunityId',
    8000,
  );
  if (error || !data) return null;
  // Supabase embed は one-to-one でも配列で返ることがある
  const raw = (data as unknown as {
    bbs_threads?:
      | { community_id: string | null }
      | Array<{ community_id: string | null }>
      | null;
  }).bbs_threads;
  if (!raw) return null;
  const t = Array.isArray(raw) ? raw[0] : raw;
  return t?.community_id ?? null;
}

async function insertModLog(input: {
  community_id: string;
  action: ModAction;
  target_post_id?: string;
  target_comment_id?: string;
  target_bbs_reply_id?: string;
  target_user_id?: string;
  reason?: string;
}): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return; // ログ書き込み失敗は silent
  const payload = {
    community_id: input.community_id,
    mod_user_id: user.id,
    target_user_id: input.target_user_id ?? null,
    target_post_id: input.target_post_id ?? null,
    target_comment_id: input.target_comment_id ?? null,
    target_bbs_reply_id: input.target_bbs_reply_id ?? null,
    action: input.action,
    reason: input.reason ?? null,
  };
  const { error } = await withApiTimeout(
    supabase.from('mod_action_logs').insert(payload),
    'communityMods.insertModLog',
    8000,
  );
  if (error) {
    // log 失敗は削除自体を巻き戻さない (削除は既に成功している)
    console.warn('[communityMods] insertModLog failed (non-fatal):', error.message);
  }
}

// 投稿削除 — RLS 経路で削除 + log を残す。
// reason は audit 用 (任意)。
export async function deletePostAsMod(
  postId: string,
  reason?: string,
): Promise<void> {
  assertUuid(postId, 'postId');

  // log 用に community_id を先に取得 (削除後だと post_communities が cascade で消えるため)
  const communityId = await fetchPostCommunityId(postId);

  const { error } = await withApiTimeout(
    supabase.from('posts').delete().eq('id', postId),
    'communityMods.deletePostAsMod',
    8000,
  );
  if (error) {
    throw new Error(`投稿の削除に失敗しました: ${error.message}`);
  }

  if (communityId) {
    await insertModLog({
      community_id: communityId,
      action: 'delete_post',
      target_post_id: postId,
      reason,
    });
  }
}

// コメント削除 — RLS 経路で削除 + log。
export async function deleteCommentAsMod(
  commentId: string,
  reason?: string,
): Promise<void> {
  assertUuid(commentId, 'commentId');

  // post_id → post_communities で community_id を逆引き (log 用)
  const postId = await fetchCommentPostId(commentId);
  const communityId = postId ? await fetchPostCommunityId(postId) : null;

  const { error } = await withApiTimeout(
    supabase.from('comments').delete().eq('id', commentId),
    'communityMods.deleteCommentAsMod',
    8000,
  );
  if (error) {
    throw new Error(`コメントの削除に失敗しました: ${error.message}`);
  }

  if (communityId) {
    await insertModLog({
      community_id: communityId,
      action: 'delete_comment',
      target_comment_id: commentId,
      reason,
    });
  }
}

// BBS 返信削除 — RLS 経路で削除 + log。
// thread.community_id が null の場合は全体スレなので mod 権限はない (RLS が deny)。
export async function deleteBBSReplyAsMod(
  replyId: string,
  reason?: string,
): Promise<void> {
  assertUuid(replyId, 'replyId');

  const communityId = await fetchBBSReplyCommunityId(replyId);

  const { error } = await withApiTimeout(
    supabase.from('bbs_replies').delete().eq('id', replyId),
    'communityMods.deleteBBSReplyAsMod',
    8000,
  );
  if (error) {
    throw new Error(`BBS 返信の削除に失敗しました: ${error.message}`);
  }

  if (communityId) {
    await insertModLog({
      community_id: communityId,
      action: 'delete_bbs_reply',
      target_bbs_reply_id: replyId,
      reason,
    });
  }
}
