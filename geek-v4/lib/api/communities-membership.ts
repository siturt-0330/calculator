// ============================================================
// lib/api/communities-membership.ts — コミュニティ参加・管理 API
// ------------------------------------------------------------
// communities.ts から分割。メンバーシップのライフサイクルに特化した関数群:
//   - joinCommunity             : open/invite 制コミュへの参加
//   - requestJoinCommunity      : request 制コミュへの参加申請
//   - leaveCommunity            : コミュニティからの退出
//   - fetchPendingJoinRequests  : 承認待ち申請一覧 (owner 向け)
//   - approveJoinRequest        : 申請承認
//   - rejectJoinRequest         : 申請却下
//   ↑ 内部ヘルパ: mapJoinError (エラーメッセージを日本語へ変換)
//
// セキュリティ上最も重要なグループ。RLS / RPC の auth.uid() が null に
// なる事故を防ぐため、すべての mutation で refreshSession を先行させる。
// ============================================================

import { supabase } from '../supabase';
import type { MemberRole } from './communities-core';

// 共通 UUID 形式チェック
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================================
// 参加系エラーメッセージのマッピング
// ============================================================
// Supabase / PostgREST から返ってくる生のエラーメッセージを日本語に丸める。
// 0025 migration 後は RPC が日本語メッセージを直接返すので、それを優先する。
function mapJoinError(raw: string): string {
  if (!raw) return 'コミュニティ参加に失敗しました。時間をおいて再度お試しください。';
  // RPC が直接返す日本語メッセージ
  if (/^[ぁ-んァ-ヴ一-龯]/.test(raw)) return raw;

  const m = raw.toLowerCase();
  if (m.includes('row-level security') || m.includes('行レベル') || m.includes('rls')) {
    return 'ログイン状態が古くなっています。一度ログアウトして入り直すか、しばらく経ってから再試行してください。';
  }
  if (m.includes('not_authenticated') || m.includes('jwt') || m.includes('not authenticated')) {
    return 'ログイン情報を確認できませんでした。再度ログインしてください。';
  }
  if (m.includes('invite_only') || m.includes('invite-only')) {
    return 'このコミュニティは招待制です。招待リンクから参加してください。';
  }
  if (m.includes('requires_approval') || m.includes('requires approval')) {
    return 'このコミュニティは参加申請が必要です。';
  }
  if (m.includes('community_not_found') || m.includes('not found')) {
    return 'コミュニティが見つかりません。削除された可能性があります。';
  }
  if (m.includes('duplicate key') || m.includes('unique constraint') || m.includes('already')) {
    return '既にこのコミュニティに登録 / 申請済みです。';
  }
  if (m.includes('network') || m.includes('fetch failed')) {
    return 'ネットワークエラー。接続を確認してください。';
  }
  // 監査追加: PostgreSQL の標準エラーコード / メッセージを追加翻訳
  if (m.includes('permission denied') || m.includes('insufficient_privilege') || m.includes('42501')) {
    return 'この操作を行う権限がありません。';
  }
  if (m.includes('pgrst') && m.includes('no row')) {
    return '対象が見つかりません。削除された可能性があります。';
  }
  if (m.includes('rate-limit') || m.includes('rate_limit') || m.includes('53300')) {
    return '短時間に試行しすぎました。少し時間を置いてからお試しください。';
  }
  if (m.includes('foreign key') || m.includes('23503')) {
    return '依存関係のあるデータがあるため操作できません。';
  }
  if (m.includes('check constraint') || m.includes('23514')) {
    return '入力内容が制約を満たしていません。';
  }
  if (m.includes('22023')) {
    return '不正な状態遷移です (承認済み/却下済みからは変更できません)。';
  }
  return raw;
}

// ============================================================
// コミュニティに参加 (open / invite)
// ============================================================
/**
 * open/invite 制コミュニティに参加する。
 * セッションが古いと RPC 内の auth.uid() が null になる事故を防ぐため
 * 先に refreshSession を呼ぶ。
 */
export async function joinCommunity(id: string): Promise<{ error: string | null }> {
  // セッションが古いと RPC 内の auth.uid() が null になる事故を防ぐ
  await supabase.auth.refreshSession().catch(() => {});
  const { error } = await supabase.rpc('join_community_by_id', { c_id: id });
  if (error) return { error: mapJoinError(error.message) };
  return { error: null };
}

// ============================================================
// 参加申請 (request 制)
// ============================================================
/**
 * request 制コミュニティへの参加申請を送る。
 * @param id       コミュニティ ID
 * @param message  申請メッセージ (省略可)
 */
export async function requestJoinCommunity(id: string, message = ''): Promise<{ error: string | null }> {
  // セッション refresh — defense in depth
  await supabase.auth.refreshSession().catch(() => {});
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'ログインしてください' };
  // user_id / status は BEFORE INSERT trigger (0025) が server side で強制するので
  // client からセットしなくても良いが、明示的に渡しておく (旧 client 互換)。
  const { error } = await supabase
    .from('community_join_requests')
    .upsert({ community_id: id, user_id: user.id, message, status: 'pending' });
  if (error) return { error: mapJoinError(error.message) };
  return { error: null };
}

// ============================================================
// 参加申請 — owner 用: 一覧取得 / 承認 / 拒否
// ------------------------------------------------------------
// request 制コミュニティで status='pending' の申請を取得・処理する。
// RLS:
//   - SELECT: owner / 申請者自身が見られる (0017)
//   - UPDATE: owner のみ (0017)
//   - community_members INSERT: owner が他人を追加可 (0026 trigger 経由)
// admin.tsx の「参加申請」セクションから呼ばれる。
// ============================================================
export type JoinRequestWithProfile = {
  community_id: string;
  user_id: string;
  message: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  nickname: string;
  avatar_emoji: string | null;
  avatar_url: string | null;
};

/**
 * 承認待ちの参加申請一覧を取得する (owner 専用)。
 * @param communityId  対象コミュニティ ID
 */
export async function fetchPendingJoinRequests(
  communityId: string,
): Promise<JoinRequestWithProfile[]> {
  if (!UUID_RE.test(communityId)) return [];
  // profiles を user_id 経由で join (公開 view profiles_public でも OK だが、
  // owner は自コミュニティに限り通常 profiles を読める想定)
  const { data, error } = await supabase
    .from('community_join_requests')
    .select('community_id, user_id, message, status, created_at, profiles!user_id ( nickname, avatar_emoji, avatar_url )')
    .eq('community_id', communityId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('[communities] fetchPendingJoinRequests:', error.message);
    return [];
  }
  // Supabase JS は FK join の戻りを array で推論しがち (たとえ to-one でも)。
  // 配列で受け取り [0] を取り出す形に統一して TS と整合させる。
  type ProfileLite = { nickname: string | null; avatar_emoji: string | null; avatar_url: string | null };
  type Row = {
    community_id: string;
    user_id: string;
    message: string | null;
    status: 'pending' | 'approved' | 'rejected';
    created_at: string;
    profiles: ProfileLite[] | ProfileLite | null;
  };
  return ((data ?? []) as unknown as Row[]).map((r) => {
    const p = Array.isArray(r.profiles) ? r.profiles[0] ?? null : r.profiles;
    return {
      community_id: r.community_id,
      user_id: r.user_id,
      message: r.message ?? '',
      status: r.status,
      created_at: r.created_at,
      nickname: p?.nickname ?? '匿名',
      avatar_emoji: p?.avatar_emoji ?? null,
      avatar_url: p?.avatar_url ?? null,
    };
  });
}

/**
 * 参加申請を承認する (owner 専用)。
 * 1) community_members に追加、2) 申請を approved に更新、の 2 ステップ。
 */
export async function approveJoinRequest(
  communityId: string,
  userId: string,
): Promise<{ error: string | null }> {
  if (!UUID_RE.test(communityId) || !UUID_RE.test(userId)) {
    return { error: '不正な ID です' };
  }
  // セッション refresh — RLS の auth.uid() が null になる事故を防ぐ
  await supabase.auth.refreshSession().catch(() => {});
  // 1. community_members に追加 (owner なら 0026 trigger で他人 INSERT が許可される)
  const { error: insErr } = await supabase
    .from('community_members')
    .insert({ community_id: communityId, user_id: userId, role: 'member' });
  if (insErr && !insErr.message.toLowerCase().includes('duplicate')) {
    // 既存メンバーなら duplicate でスキップ、それ以外は失敗
    console.warn('[communities] approveJoinRequest insert:', insErr.message);
    return { error: insErr.message };
  }
  // 2. 申請の status を approved に更新 (一覧から消える)
  const { error: updErr } = await supabase
    .from('community_join_requests')
    .update({ status: 'approved' })
    .eq('community_id', communityId)
    .eq('user_id', userId);
  if (updErr) {
    console.warn('[communities] approveJoinRequest update:', updErr.message);
    return { error: updErr.message };
  }
  return { error: null };
}

/**
 * 参加申請を却下する (owner 専用)。
 */
export async function rejectJoinRequest(
  communityId: string,
  userId: string,
): Promise<{ error: string | null }> {
  if (!UUID_RE.test(communityId) || !UUID_RE.test(userId)) {
    return { error: '不正な ID です' };
  }
  await supabase.auth.refreshSession().catch(() => {});
  const { error } = await supabase
    .from('community_join_requests')
    .update({ status: 'rejected' })
    .eq('community_id', communityId)
    .eq('user_id', userId);
  if (error) {
    console.warn('[communities] rejectJoinRequest:', error.message);
    return { error: error.message };
  }
  return { error: null };
}

// ============================================================
// コミュニティから退出
// ============================================================
// 監査での指摘 (Critical):
//   - owner が脱退すると「孤児コミュ」が生成される (誰も管理できない)
//   - 公式コミュ管理者が脱退しても official_admin_user_id が残り、
//     attachOfficialAuthor で de-anonymize が継続する
// → 本関数で role / 公式 admin を検査して、危険なケースは block する。
/**
 * コミュニティから退出する。
 * owner や公式管理者は退出をブロックする (孤児コミュ防止)。
 */
export async function leaveCommunity(id: string): Promise<{ error: string | null }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'ログインしてください' };

  // 自分の role と community の公式情報を取得 (1 RTT)
  const [meRes, commRes] = await Promise.all([
    supabase
      .from('community_members')
      .select('role')
      .eq('community_id', id)
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('communities')
      .select('is_official, official_admin_user_id')
      .eq('id', id)
      .maybeSingle(),
  ]);

  const role = (meRes.data as { role: MemberRole } | null)?.role ?? null;
  if (role === 'owner') {
    return {
      error: 'コミュニティのオーナーは退出できません。先に所有権を譲渡するか、コミュニティを削除してください。',
    };
  }

  const comm = commRes.data as { is_official: boolean | null; official_admin_user_id: string | null } | null;
  if (comm?.is_official && comm.official_admin_user_id === user.id) {
    return {
      error: '公式コミュニティの管理者は退出できません。先に公式申請の取り下げ、または管理者の変更を申請してください。',
    };
  }

  const { error } = await supabase
    .from('community_members')
    .delete()
    .eq('community_id', id)
    .eq('user_id', user.id);
  if (error) return { error: mapJoinError(error.message) };
  return { error: null };
}
