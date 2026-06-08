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

// RPC が「まだ存在しない」(= migration 未適用) を検知する。PostgREST は
// 関数未検出を PGRST202 (schema cache) で返す。これを使って「新 RPC があれば
// 使う / 無ければ旧経路にフォールバック」のデプロイ順序耐性を作る。
function isMissingFunction(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = (error as { code?: string }).code ?? '';
  const msg = (error as { message?: string }).message ?? '';
  return (
    code === 'PGRST202' ||
    /could not find the function|function .* does not exist|schema cache/i.test(msg)
  );
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
  | 'demote'
  | 'transfer_owner';

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

// 昇格 (member → admin)。owner だけが呼び出せる (RPC 内で owner 判定)。
// 自分自身 / owner / 非メンバー は RPC が exception を返す。
export async function promoteMember(
  communityId: string,
  userId: string,
): Promise<void> {
  assertUuid(communityId, 'communityId');
  assertUuid(userId, 'userId');

  const { error } = await withApiTimeout(
    supabase.rpc('mod_promote_member', {
      target_community_id: communityId,
      target_user_id: userId,
    }),
    'communityMods.promoteMember',
    8000,
  );
  if (error) {
    throw new Error(`管理人への昇格に失敗しました: ${error.message}`);
  }
}

// 降格 (admin → member)。owner だけが呼び出せる (RPC 内で owner 判定)。
// 自分自身 / owner / 非メンバー / 既に member は RPC が exception を返す。
export async function demoteMember(
  communityId: string,
  userId: string,
): Promise<void> {
  assertUuid(communityId, 'communityId');
  assertUuid(userId, 'userId');

  const { error } = await withApiTimeout(
    supabase.rpc('mod_demote_member', {
      target_community_id: communityId,
      target_user_id: userId,
    }),
    'communityMods.demoteMember',
    8000,
  );
  if (error) {
    throw new Error(`member への降格に失敗しました: ${error.message}`);
  }
}

// オーナー譲渡 (owner → 別メンバー)。現 owner だけが呼べる (RPC 内で owner 判定)。
// 旧 owner は admin に降りる。自分自身 / 非メンバー / 既に owner は RPC が exception を返す。
export async function transferOwnership(
  communityId: string,
  newOwnerId: string,
): Promise<void> {
  assertUuid(communityId, 'communityId');
  assertUuid(newOwnerId, 'newOwnerId');

  const { error } = await withApiTimeout(
    supabase.rpc('mod_transfer_ownership', {
      target_community_id: communityId,
      new_owner_id: newOwnerId,
    }),
    'communityMods.transferOwnership',
    8000,
  );
  if (error) {
    throw new Error(`オーナーの譲渡に失敗しました: ${error.message}`);
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

// 投稿削除 — まず mod_delete_post RPC (server 内で author を解決して本人へ通知 +
// 匿名性維持) を試し、未適用 (0136 前) なら旧 RLS 直 DELETE 経路にフォールバック。
// reason は対象本人への通知に使われる (任意)。
export async function deletePostAsMod(
  postId: string,
  reason?: string,
): Promise<void> {
  assertUuid(postId, 'postId');

  const { error } = await withApiTimeout(
    supabase.rpc('mod_delete_post', { p_post_id: postId, p_reason: reason ?? null }),
    'communityMods.modDeletePost',
    8000,
  );
  if (!error) return;
  if (!isMissingFunction(error)) {
    throw new Error(`投稿の削除に失敗しました: ${error.message}`);
  }
  // 0136 未適用 → 旧経路 (通知は飛ばない)
  await legacyDeletePostAsMod(postId, reason);
}

// 旧経路: RLS 直 DELETE + client log (0136 未適用時のフォールバック)。
async function legacyDeletePostAsMod(postId: string, reason?: string): Promise<void> {
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
    // ★target_post_id は残さない: (1) 0136 RPC 経路と一貫 (匿名維持の defense-in-depth)、
    //   (2) 削除済み post への FK 参照を避ける (旧実装は FK 違反で log 自体が無言失敗していた)。
    await insertModLog({
      community_id: communityId,
      action: 'delete_post',
      reason,
    });
  }
}

// コメント削除 — RPC 優先 (本人通知 + 匿名維持) → 未適用なら旧経路。
export async function deleteCommentAsMod(
  commentId: string,
  reason?: string,
): Promise<void> {
  assertUuid(commentId, 'commentId');

  const { error } = await withApiTimeout(
    supabase.rpc('mod_delete_comment', { p_comment_id: commentId, p_reason: reason ?? null }),
    'communityMods.modDeleteComment',
    8000,
  );
  if (!error) return;
  if (!isMissingFunction(error)) {
    throw new Error(`コメントの削除に失敗しました: ${error.message}`);
  }
  await legacyDeleteCommentAsMod(commentId, reason);
}

async function legacyDeleteCommentAsMod(commentId: string, reason?: string): Promise<void> {
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
    // target_comment_id は残さない (0136 RPC 経路と一貫 + 削除済み行への FK 違反回避)
    await insertModLog({
      community_id: communityId,
      action: 'delete_comment',
      reason,
    });
  }
}

// BBS 返信削除 — RPC 優先 (本人通知 + 匿名維持) → 未適用なら旧経路。
// thread.community_id が null の場合は全体スレなので mod 権限はない (RLS / RPC が deny)。
export async function deleteBBSReplyAsMod(
  replyId: string,
  reason?: string,
): Promise<void> {
  assertUuid(replyId, 'replyId');

  const { error } = await withApiTimeout(
    supabase.rpc('mod_delete_bbs_reply', { p_reply_id: replyId, p_reason: reason ?? null }),
    'communityMods.modDeleteBBSReply',
    8000,
  );
  if (!error) return;
  if (!isMissingFunction(error)) {
    throw new Error(`BBS 返信の削除に失敗しました: ${error.message}`);
  }
  await legacyDeleteBBSReplyAsMod(replyId, reason);
}

async function legacyDeleteBBSReplyAsMod(replyId: string, reason?: string): Promise<void> {
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
    // target_bbs_reply_id は残さない (0136 RPC 経路と一貫 + 削除済み行への FK 違反回避)
    await insertModLog({
      community_id: communityId,
      action: 'delete_bbs_reply',
      reason,
    });
  }
}

// ============================================================
// コミュニティ通報キュー (0108 + 0136) — mod が自コミュの通報を確認/対応
// ============================================================
// ★get_community_reports は 0136 で author_id を返さない形に硬化済 (匿名維持)。
//   UI は post_id ベースで「投稿を開く / 削除 / 対応済み」する。
export type CommunityReport = {
  post_id: string;
  report_count: number;
  /** 通報理由 (重複排除済。null を含み得るので UI 側で filter する) */
  reasons: (string | null)[];
  latest_reported_at: string;
  content_preview: string | null;
};

// 未対応の通報を集計取得 (mod 限定 RPC)。RPC 未適用 (0108/0136 前) は空配列で
// graceful degrade (画面を壊さない)。mod でない等の実エラーは throw。
export async function fetchCommunityReports(
  communityId: string,
): Promise<CommunityReport[]> {
  assertUuid(communityId, 'communityId');

  const { data, error } = await withApiTimeout(
    supabase.rpc('get_community_reports', { p_community_id: communityId }),
    'communityMods.fetchCommunityReports',
    8000,
  );
  if (error) {
    if (isMissingFunction(error)) return []; // RPC 未適用 → 通報キューは「準備中」= 空
    console.warn('[communityMods] fetchCommunityReports failed:', error.message);
    throw new Error(`通報の取得に失敗しました: ${error.message}`);
  }
  type Row = {
    post_id: string;
    report_count: number | string;
    reasons: (string | null)[] | null;
    latest_reported_at: string;
    content_preview: string | null;
  };
  const rows = (data ?? []) as Row[];
  // ★de-anon ガード (defense-in-depth):
  //   0136 未適用で 0108 旧 RPC が応答に author_id を載せている場合は、匿名投稿の
  //   作者が漏れるため UI に出さない (空キュー扱い)。0136 適用後は author_id を
  //   返さないので通常表示される。応答が既に網を通った点は server 側 (0136) が真の
  //   修正だが、UI で確実に出さないためのガード。
  if (rows.some((r) => Object.prototype.hasOwnProperty.call(r, 'author_id'))) {
    console.warn(
      '[communityMods] get_community_reports returned author_id — 0136 未適用の可能性。' +
        '匿名性保護のため通報キューを非表示にします (migration 0136 を適用してください)。',
    );
    return [];
  }
  return rows.map((r) => ({
    post_id: r.post_id,
    report_count: Number(r.report_count) || 0,
    reasons: Array.isArray(r.reasons) ? r.reasons : [],
    latest_reported_at: r.latest_reported_at,
    content_preview: r.content_preview ?? null,
  }));
}

// 通報を「対応済み」にする (mod 限定 / idempotent)。
export async function resolveCommunityReport(
  communityId: string,
  postId: string,
): Promise<void> {
  assertUuid(communityId, 'communityId');
  assertUuid(postId, 'postId');

  const { error } = await withApiTimeout(
    supabase.rpc('resolve_community_report', {
      p_community_id: communityId,
      p_post_id: postId,
    }),
    'communityMods.resolveCommunityReport',
    8000,
  );
  if (error && !isMissingFunction(error)) {
    throw new Error(`通報の対応済み化に失敗しました: ${error.message}`);
  }
}
