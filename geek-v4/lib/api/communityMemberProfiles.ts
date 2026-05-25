// ============================================================
// lib/api/communityMemberProfiles.ts
// ------------------------------------------------------------
// migration 0047 で導入した community_member_profiles の API ラッパ。
// 1 user × 1 community = 1 行で「コミュ内マイプロフィール」を持つ。
//
// RLS:
//   - select: open or member
//   - insert/update/delete: 自分のみ
// ============================================================

import { supabase } from '../supabase';
import { sanitizeText } from '../sanitize';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CommunityMemberProfile = {
  community_id: string;
  user_id: string;
  top_oshi: string;
  oshi_since: string | null; // ISO 'YYYY-MM-DD'
  attended_count: number;
  my_setlist: string[];
  extra: Record<string, unknown>;
  updated_at: string;
  created_at: string;
};

// 自分の (community, user_id) のレコードを取得
// 無ければ null (まだ作成していない)
export async function fetchMyMemberProfile(
  community_id: string,
): Promise<CommunityMemberProfile | null> {
  if (!UUID_RE.test(community_id)) return null;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('community_member_profiles')
    .select('*')
    .eq('community_id', community_id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) {
    console.warn('[memberProfiles] fetch failed:', error.message);
    return null;
  }
  return data as CommunityMemberProfile | null;
}

// 他メンバーのプロフィール取得 (open or member のみ — RLS で担保)
export async function fetchMemberProfile(
  community_id: string,
  user_id: string,
): Promise<CommunityMemberProfile | null> {
  if (!UUID_RE.test(community_id) || !UUID_RE.test(user_id)) return null;
  const { data, error } = await supabase
    .from('community_member_profiles')
    .select('*')
    .eq('community_id', community_id)
    .eq('user_id', user_id)
    .maybeSingle();
  if (error) return null;
  return data as CommunityMemberProfile | null;
}

// 自分のプロフィールを upsert (なければ insert、あれば update)
// RLS 上「member only」「自分のレコードのみ」が担保されているので
// trust なフィールドだけ送る。
export async function upsertMyMemberProfile(input: {
  community_id: string;
  top_oshi?: string;
  oshi_since?: string | null; // YYYY-MM-DD
  attended_count?: number;
  my_setlist?: string[];
}): Promise<{ data: CommunityMemberProfile | null; error: string | null }> {
  if (!UUID_RE.test(input.community_id)) {
    return { data: null, error: '不正なコミュニティ ID です' };
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'ログインしてください' };

  // sanitize
  const top_oshi = input.top_oshi !== undefined
    ? sanitizeText(input.top_oshi, { maxLength: 100 }).trim()
    : undefined;
  const attended_count = input.attended_count !== undefined
    ? Math.max(0, Math.min(9999, Math.floor(input.attended_count)))
    : undefined;
  const my_setlist = input.my_setlist !== undefined
    ? input.my_setlist
        .slice(0, 50)
        .map((v) => sanitizeText(v, { maxLength: 200 }).trim())
        .filter((v) => v.length > 0)
    : undefined;

  // oshi_since の形式チェック (YYYY-MM-DD)
  let oshi_since: string | null | undefined;
  if (input.oshi_since !== undefined) {
    if (input.oshi_since === null || input.oshi_since === '') {
      oshi_since = null;
    } else {
      const d = new Date(input.oshi_since);
      if (Number.isNaN(d.getTime())) {
        return { data: null, error: '推し歴の日付が不正です' };
      }
      // YYYY-MM-DD で正規化
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      oshi_since = `${y}-${m}-${dd}`;
    }
  }

  const row: Record<string, unknown> = {
    community_id: input.community_id,
    user_id: user.id,
  };
  if (top_oshi !== undefined) row.top_oshi = top_oshi;
  if (oshi_since !== undefined) row.oshi_since = oshi_since;
  if (attended_count !== undefined) row.attended_count = attended_count;
  if (my_setlist !== undefined) row.my_setlist = my_setlist;

  const { data, error } = await supabase
    .from('community_member_profiles')
    .upsert(row, { onConflict: 'community_id,user_id' })
    .select()
    .single();

  if (error || !data) {
    const msg = error?.message ?? 'プロフィールの保存に失敗しました';
    if (msg.includes('SETLIST_ITEM_TOO_LONG')) {
      return { data: null, error: 'セトリの 1 項目が長すぎます (200 文字以下)' };
    }
    return { data: null, error: msg };
  }
  return { data: data as CommunityMemberProfile, error: null };
}

// 自分のプロフィールを削除 (退会・リセット時)
export async function deleteMyMemberProfile(
  community_id: string,
): Promise<{ error: string | null }> {
  if (!UUID_RE.test(community_id)) return { error: '不正なコミュニティ ID です' };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'ログインしてください' };

  const { error } = await supabase
    .from('community_member_profiles')
    .delete()
    .eq('community_id', community_id)
    .eq('user_id', user.id);
  if (error) return { error: error.message };
  return { error: null };
}

// =============================================
// クライアントヘルパー (UI 用)
// =============================================

// '推し歴 N 年 M ヶ月' を計算
export function formatOshiSince(oshi_since: string | null): string | null {
  if (!oshi_since) return null;
  const start = new Date(oshi_since);
  if (Number.isNaN(start.getTime())) return null;
  const now = new Date();
  const totalMonths = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (totalMonths < 0) return null;
  if (totalMonths < 1) return '推し歴 1 ヶ月未満';
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  if (years === 0) return `推し歴 ${months} ヶ月`;
  if (months === 0) return `推し歴 ${years} 年`;
  return `推し歴 ${years} 年 ${months} ヶ月`;
}
