// ============================================================
// lib/api/friends.ts — 友達追加 + 招待リンク (migration 0051)
// ============================================================
// docs/MYPAGE_ALBUMS_SPEC.md § 4.1 を参照。
// - 検索 UI なし。友達は招待リンク (friend_invites) を共有して成立する。
// - 承認は accept_friend_invite RPC (security definer) で安全に行う。
// - 全 supabase 呼び出しは withApiTimeout でラップ (CLAUDE.md § 5.1)。
// ============================================================

import { supabase } from '../supabase';
import { withApiTimeout } from '../withApiTimeout';
import { checkRate, rateLimitMessage } from '../rateLimit';
import type { Friendship, FriendInvite } from '../../types/models';

// friend_profile が必ず付いた状態を返す型 (UI 側で undefined 判定不要にする)
export type FriendshipWithProfile = Friendship & {
  friend_profile: NonNullable<Friendship['friend_profile']>;
};

// ============================================================
// 内部ユーティリティ
// ============================================================

// profiles をまとめて取得し、id → profile の Map にする。
// 取得失敗 / 部分欠落でも返せるよう、見つからなかった id は単に Map から消える。
type FriendProfileRow = {
  id: string;
  nickname: string | null;
  avatar_url: string | null;
  avatar_emoji: string | null;
  bio: string | null;
};

async function fetchProfilesById(ids: string[]): Promise<Map<string, FriendProfileRow>> {
  if (ids.length === 0) return new Map();
  const unique = Array.from(new Set(ids));
  const { data, error } = await withApiTimeout(
    supabase
      .from('profiles')
      .select('id, nickname, avatar_url, avatar_emoji, bio')
      .in('id', unique),
    'friends.fetchProfilesById',
    8000,
  );
  if (error) {
    console.warn('[friends] fetchProfilesById failed:', error.message);
    return new Map();
  }
  const rows = (data ?? []) as FriendProfileRow[];
  const map = new Map<string, FriendProfileRow>();
  for (const row of rows) map.set(row.id, row);
  return map;
}

// friendship row (生) + selfId から、相手 user の profile を join した
// FriendshipWithProfile を組み立てる。profile が欠落していた場合は
// プレースホルダで埋める (UI 側で nickname=null は「匿名さん」等で表示する想定)。
function attachFriendProfile(
  row: Friendship,
  selfId: string,
  profileMap: Map<string, FriendProfileRow>,
): FriendshipWithProfile {
  const otherId = row.requester_id === selfId ? row.recipient_id : row.requester_id;
  const profile = profileMap.get(otherId);
  return {
    ...row,
    friend_profile: profile ?? {
      id: otherId,
      nickname: null,
      avatar_url: null,
      avatar_emoji: null,
      bio: null,
    },
  };
}

// ============================================================
// 友達一覧 / リクエスト
// ============================================================

// accepted ステータスのみ取得。相手 profile を join して返す。
export async function fetchMyFriends(): Promise<FriendshipWithProfile[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const selfId = user.id;

  const { data, error } = await withApiTimeout(
    supabase
      .from('friendships')
      .select('id, requester_id, recipient_id, status, created_at, accepted_at')
      .eq('status', 'accepted')
      .or(`requester_id.eq.${selfId},recipient_id.eq.${selfId}`)
      .order('accepted_at', { ascending: false, nullsFirst: false }),
    'friends.fetchMyFriends',
    8000,
  );
  if (error) {
    console.warn('[friends] fetchMyFriends failed:', error.message);
    return [];
  }
  const rows = (data ?? []) as Friendship[];
  if (rows.length === 0) return [];

  const otherIds = rows.map((r) => (r.requester_id === selfId ? r.recipient_id : r.requester_id));
  const profileMap = await fetchProfilesById(otherIds);
  return rows.map((r) => attachFriendProfile(r, selfId, profileMap));
}

// 自分宛て / 自分発の pending リクエストを分けて返す。
export async function fetchPendingRequests(): Promise<{
  incoming: FriendshipWithProfile[];
  outgoing: FriendshipWithProfile[];
}> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { incoming: [], outgoing: [] };
  const selfId = user.id;

  const { data, error } = await withApiTimeout(
    supabase
      .from('friendships')
      .select('id, requester_id, recipient_id, status, created_at, accepted_at')
      .eq('status', 'pending')
      .or(`requester_id.eq.${selfId},recipient_id.eq.${selfId}`)
      .order('created_at', { ascending: false }),
    'friends.fetchPendingRequests',
    8000,
  );
  if (error) {
    console.warn('[friends] fetchPendingRequests failed:', error.message);
    return { incoming: [], outgoing: [] };
  }
  const rows = (data ?? []) as Friendship[];
  if (rows.length === 0) return { incoming: [], outgoing: [] };

  const otherIds = rows.map((r) => (r.requester_id === selfId ? r.recipient_id : r.requester_id));
  const profileMap = await fetchProfilesById(otherIds);
  const incoming: FriendshipWithProfile[] = [];
  const outgoing: FriendshipWithProfile[] = [];
  for (const row of rows) {
    const enriched = attachFriendProfile(row, selfId, profileMap);
    if (row.recipient_id === selfId) incoming.push(enriched);
    else outgoing.push(enriched);
  }
  return { incoming, outgoing };
}

// 受諾 — RLS 上 recipient_id = auth.uid() のみ update 可
export async function acceptFriend(friendshipId: string): Promise<void> {
  const { error } = await withApiTimeout(
    supabase
      .from('friendships')
      .update({ status: 'accepted', accepted_at: new Date().toISOString() })
      .eq('id', friendshipId),
    'friends.acceptFriend',
    8000,
  );
  if (error) throw new Error(`友達リクエストの承認に失敗しました: ${error.message}`);
}

// 拒否 = DELETE (RLS で requester / recipient のみ削除可)
export async function declineFriend(friendshipId: string): Promise<void> {
  const { error } = await withApiTimeout(
    supabase.from('friendships').delete().eq('id', friendshipId),
    'friends.declineFriend',
    8000,
  );
  if (error) throw new Error(`友達リクエストの拒否に失敗しました: ${error.message}`);
}

// 友達解除 — accepted 状態のレコードを delete (RLS で双方が削除可)
export async function unfriend(friendshipId: string): Promise<void> {
  const { error } = await withApiTimeout(
    supabase.from('friendships').delete().eq('id', friendshipId),
    'friends.unfriend',
    8000,
  );
  if (error) throw new Error(`友達解除に失敗しました: ${error.message}`);
}

// ============================================================
// 招待コード (friend_invites)
// ============================================================

// 自分が発行した招待を新しい順に。expires_at / used_by の評価は UI 側に委譲。
export async function fetchMyInvites(): Promise<FriendInvite[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await withApiTimeout(
    supabase
      .from('friend_invites')
      .select('code, created_by, used_by, created_at, expires_at, used_at')
      .eq('created_by', user.id)
      .order('created_at', { ascending: false }),
    'friends.fetchMyInvites',
    8000,
  );
  if (error) {
    console.warn('[friends] fetchMyInvites failed:', error.message);
    return [];
  }
  return (data ?? []) as FriendInvite[];
}

// 招待コード生成: 16 文字、英大文字+数字 (紛らわしい I / O / 0 / 1 を除く)
// → alphabet は 32 文字。crypto.getRandomValues でバイアスなくサンプリング。
// 衝突したら 1 回だけ retry (招待は表示用なので衝突は事実上ゼロ)。
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 文字
const INVITE_CODE_LENGTH = 16;

function generateInviteCode(): string {
  // 32 文字 alphabet なら 256 byte は 8 で割り切れて bias なし
  const buf = new Uint8Array(INVITE_CODE_LENGTH);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(buf);
  } else {
    // フォールバック (旧 RN 等): Math.random — 衝突確率は実用上問題なし
    for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
      buf[i] = Math.floor(Math.random() * 256);
    }
  }
  let out = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    // 32 でマスクすれば bias なく 0..31 を取れる (256 % 32 = 0)
    // noUncheckedIndexedAccess: buf[i] は number | undefined。Uint8Array なので
    // 範囲内 index は必ず number だが TS に伝わらないので明示 fallback。
    const byte = buf[i] ?? 0;
    const idx = byte & 0x1f;
    out += INVITE_ALPHABET.charAt(idx);
  }
  return out;
}

// PostgreSQL の unique 違反 (23505) を判定する helper
function isUniqueViolation(err: { code?: string | null; message?: string | null } | null): boolean {
  if (!err) return false;
  if (err.code === '23505') return true;
  const msg = (err.message ?? '').toLowerCase();
  return msg.includes('duplicate key') || msg.includes('unique constraint');
}

// 招待リンク作成。code 衝突したら 1 回だけ retry する。
export async function createFriendInvite(): Promise<FriendInvite> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('ログインしてください');

  for (let attempt = 0; attempt < 2; attempt++) {
    const code = generateInviteCode();
    const { data, error } = await withApiTimeout(
      supabase
        .from('friend_invites')
        .insert({ code, created_by: user.id })
        .select('code, created_by, used_by, created_at, expires_at, used_at')
        .single(),
      'friends.createFriendInvite',
      8000,
    );
    if (!error && data) {
      return data as FriendInvite;
    }
    // 衝突 → 1 回だけ retry。他のエラーは即時 throw。
    if (isUniqueViolation(error) && attempt === 0) {
      continue;
    }
    throw new Error(`招待コード作成に失敗しました: ${error?.message ?? 'unknown'}`);
  }
  // ここには到達しないが noImplicitReturns 対策
  throw new Error('招待コード作成に失敗しました (重複)');
}

export async function revokeInvite(code: string): Promise<void> {
  const { error } = await withApiTimeout(
    supabase.from('friend_invites').delete().eq('code', code),
    'friends.revokeInvite',
    8000,
  );
  if (error) throw new Error(`招待の取り消しに失敗しました: ${error.message}`);
}

// 招待コード受諾 (RPC accept_friend_invite). 結果は jsonb で来る。
export async function acceptInvite(code: string): Promise<{
  ok: boolean;
  error?: string;
  friendshipId?: string;
}> {
  // brute-force による invite code 総当たり防止 (1 分間に 5 回まで)。
  // ネットワーク往復前にローカルで弾くので、無駄な API 呼び出しも抑制できる。
  const rl = checkRate('friend_invite_accept');
  if (!rl.ok) {
    throw new Error(rateLimitMessage('friend_invite_accept', rl.retryAfterMs));
  }

  // セッションが古いと RPC 内の auth.uid() が null になる事故を防ぐ
  await supabase.auth.refreshSession().catch(() => {});

  const { data, error } = await withApiTimeout(
    supabase.rpc('accept_friend_invite', { code_in: code }),
    'friends.acceptInvite',
    8000,
  );
  if (error) {
    return { ok: false, error: error.message };
  }
  // 想定 shape: { ok: boolean, error?: string, friendship_id?: string }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const obj = data as { ok?: unknown; error?: unknown; friendship_id?: unknown };
    const ok = obj.ok === true;
    const errMsg = typeof obj.error === 'string' ? obj.error : undefined;
    const fid = typeof obj.friendship_id === 'string' ? obj.friendship_id : undefined;
    if (ok) {
      return fid ? { ok: true, friendshipId: fid } : { ok: true };
    }
    return errMsg ? { ok: false, error: errMsg } : { ok: false, error: '招待の受諾に失敗しました' };
  }
  return { ok: false, error: '想定外の応答形式です' };
}

// ============================================================
// 招待 URL のヘルパ
// ============================================================
// EXPO_PUBLIC_APP_URL を base に。env が無ければ Netlify の本番 URL。
// process.env.EXPO_PUBLIC_* は static にしか参照できない (CLAUDE.md § 14) ので
// ベタ書きする。
export function inviteUrlFor(code: string): string {
  const base = process.env.EXPO_PUBLIC_APP_URL || 'https://geekboard.netlify.app';
  // 末尾 slash の二重結合を避ける
  const trimmed = base.endsWith('/') ? base.slice(0, -1) : base;
  return `${trimmed}/invite/${code}`;
}
