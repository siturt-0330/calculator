// ============================================================
// Community Stamps API
// ============================================================
// 仕様:
//   - スタンプはコミュメンバーのみが作成できる
//   - そのコミュに紐付いた投稿に対してのみリアクションとして使える
//   - 同一コミュ内で label の重複は禁止 (DB unique 制約)
//
// 設計: lib/api/reactions.ts (post_reactions) と同じパターンを継承。
//        1 RTT toggle / Map-based 集計 / mine フラグ。
// ============================================================
import { supabase } from '../supabase';
import { checkRate, rateLimitMessage } from '../rateLimit';
import { sanitizeContent } from '../sanitize';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PostgreSQL の error code を明示判定するための定数。
// 文字列 message へのキーワード matching は locale / pg バージョン依存で fragile。
const PG_UNIQUE_VIOLATION = '23505';
const PG_RLS_VIOLATION = '42501';

export type CommunityStamp = {
  id: string;
  community_id: string;
  creator_id: string | null;
  label: string;
  image_url: string | null;
  use_count: number;
  created_at: string;
};

export type CommunityStampReactionRow = {
  post_id: string;
  user_id: string;
  stamp_id: string;
};

export type CommunityStampAgg = {
  stamp: CommunityStamp;
  count: number;
  mine: boolean;
};

export type CommunityStampReactionsByPost = Record<string, CommunityStampAgg[]>;

// ============================================================
// listCommunityStamps — 1 コミュの全スタンプを use_count 降順で取得
// ============================================================
export async function listCommunityStamps(community_id: string): Promise<CommunityStamp[]> {
  if (!UUID_RE.test(community_id)) return [];
  const { data, error } = await supabase
    .from('community_stamps')
    .select('*')
    .eq('community_id', community_id)
    .order('use_count', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) {
    console.warn('[communityStamps] list failed:', error.message);
    return [];
  }
  return (data ?? []) as CommunityStamp[];
}

// ============================================================
// createCommunityStamp — メンバーのみが新規作成
// ============================================================
export async function createCommunityStamp(input: {
  community_id: string;
  label: string;
  image_url?: string | null;
}): Promise<{ data: CommunityStamp | null; error: string | null }> {
  if (!UUID_RE.test(input.community_id)) {
    return { data: null, error: '不正なコミュニティ ID です' };
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'ログインしてください' };

  // sanitize + 長さチェック
  const safeLabel = sanitizeContent(input.label, { maxLength: 40 }).trim();
  if (safeLabel.length < 1) {
    return { data: null, error: 'スタンプの文字を入力してください' };
  }
  if (safeLabel.length > 40) {
    return { data: null, error: 'スタンプは 40 文字以内にしてください' };
  }
  // 画像 URL は HTTPS のみ (オプション)
  if (input.image_url && !/^https:\/\//.test(input.image_url)) {
    return { data: null, error: '画像 URL は https:// で始まる必要があります' };
  }

  const { data, error } = await supabase
    .from('community_stamps')
    .insert({
      community_id: input.community_id,
      creator_id: user.id,
      label: safeLabel,
      image_url: input.image_url ?? null,
    })
    .select()
    .single();
  if (error || !data) {
    if (error?.code === PG_UNIQUE_VIOLATION) {
      return { data: null, error: 'そのスタンプは既にこのコミュニティに存在します' };
    }
    if (error?.code === PG_RLS_VIOLATION) {
      return { data: null, error: 'コミュニティのメンバーのみ作成できます' };
    }
    return { data: null, error: error?.message || 'スタンプの作成に失敗しました' };
  }
  return { data: data as CommunityStamp, error: null };
}

// ============================================================
// deleteCommunityStamp — 作成者 or owner が削除 (RLS で担保)
// ============================================================
export async function deleteCommunityStamp(stamp_id: string): Promise<{ error: string | null }> {
  if (!UUID_RE.test(stamp_id)) return { error: '不正なスタンプ ID です' };
  const { error } = await supabase.from('community_stamps').delete().eq('id', stamp_id);
  if (error) {
    if (error.code === PG_RLS_VIOLATION) {
      return { error: '作成者またはコミュニティオーナーのみ削除できます' };
    }
    return { error: error.message };
  }
  return { error: null };
}

// ============================================================
// fetchCommunityStampReactionsForPosts — 集計取得 (post_reactions と同じ shape)
// ============================================================
// 各 post に対して `stamp + count + mine` の配列を返す。
// stamp 情報も同じレスポンスに混ぜることで N+1 を回避。
export async function fetchCommunityStampReactionsForPosts(
  postIds: string[],
): Promise<CommunityStampReactionsByPost> {
  if (postIds.length === 0) return {};
  const { data: session } = await supabase.auth.getSession();
  const myId = session.session?.user.id;

  // reactions と stamps を 1 リクエストで join
  const { data, error } = await supabase
    .from('community_stamp_reactions')
    .select('post_id, user_id, stamp_id, stamp:community_stamps(id, community_id, creator_id, label, image_url, use_count, created_at)')
    .in('post_id', postIds);
  if (error) {
    console.warn('[communityStamps] fetchReactions failed:', error.message);
    return {};
  }

  type Row = {
    post_id: string;
    user_id: string;
    stamp_id: string;
    stamp: CommunityStamp | CommunityStamp[] | null;
  };
  const rows = (data ?? []) as unknown as Row[];

  // post → stamp_id → { stamp, count, mine }
  const byPost: Record<string, Record<string, { stamp: CommunityStamp; count: number; mine: boolean }>> = {};
  for (const r of rows) {
    const stamp = Array.isArray(r.stamp) ? r.stamp[0] : r.stamp;
    if (!stamp) continue;
    const byStamp = byPost[r.post_id] ?? (byPost[r.post_id] = {});
    const slot = byStamp[r.stamp_id] ?? { stamp, count: 0, mine: false };
    slot.count += 1;
    if (myId && r.user_id === myId) slot.mine = true;
    byStamp[r.stamp_id] = slot;
  }

  const result: CommunityStampReactionsByPost = {};
  for (const pid of postIds) {
    const m = byPost[pid];
    if (!m) { result[pid] = []; continue; }
    result[pid] = Object.values(m).sort((a, b) => b.count - a.count);
  }
  return result;
}

// ============================================================
// toggleCommunityStampReaction — 1 RTT トグル (DELETE → INSERT)
// ============================================================
// communityId を呼び出し側から受け取ることで INSERT 前の追加 fetch を排除。
// 未指定の場合のみ DB から取得 (後方互換フォールバック)。
export async function toggleCommunityStampReaction(
  postId: string,
  stampId: string,
  communityId?: string,
): Promise<{ on: boolean; error: string | null }> {
  if (!UUID_RE.test(postId) || !UUID_RE.test(stampId)) {
    return { on: false, error: '不正な ID です' };
  }
  const rl = checkRate('reaction');
  if (!rl.ok) return { on: false, error: rateLimitMessage('reaction', rl.retryAfterMs) };

  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) return { on: false, error: 'ログインしてください' };

  // 既存削除 → 当たれば toggle off
  const { data: deleted } = await supabase
    .from('community_stamp_reactions')
    .delete()
    .eq('post_id', postId)
    .eq('user_id', userId)
    .eq('stamp_id', stampId)
    .select('post_id');

  if (deleted && deleted.length > 0) return { on: false, error: null };

  // communityId 未提供の場合のみ DB fetch (追加 RTT)
  let resolvedCommunityId = communityId;
  if (!resolvedCommunityId) {
    const { data: stampRow, error: sErr } = await supabase
      .from('community_stamps')
      .select('community_id')
      .eq('id', stampId)
      .maybeSingle();
    if (sErr || !stampRow) {
      return { on: false, error: 'スタンプが見つかりません' };
    }
    resolvedCommunityId = (stampRow as { community_id: string }).community_id;
  }

  const { error } = await supabase
    .from('community_stamp_reactions')
    .upsert(
      { post_id: postId, user_id: userId, stamp_id: stampId, community_id: resolvedCommunityId },
      { onConflict: 'post_id,user_id,stamp_id', ignoreDuplicates: true },
    );
  if (error) {
    if (error.code === PG_RLS_VIOLATION) {
      return { on: false, error: 'このスタンプはこの投稿には使用できません (コミュ非メンバー、または投稿が別コミュ)' };
    }
    return { on: false, error: error.message };
  }
  return { on: true, error: null };
}
