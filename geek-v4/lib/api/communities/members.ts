// ============================================================
// communities/members.ts — メンバーシップ系 + realtime
// ============================================================
// join / leave / request 申請 + 自分の membership 変化を購読する realtime helper。
// 退出 (leaveCommunity) は owner / 公式 admin の保護ロジック入り。
// ============================================================
import { supabase } from '../../supabase';
import { mapJoinError } from './_helpers';
import type { MemberRole } from './types';

// ============================================================
// コミュニティに参加 (open / invite)
// ============================================================
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
// コミュニティから退出
// ============================================================
// 監査での指摘 (Critical):
//   - owner が脱退すると「孤児コミュ」が生成される (誰も管理できない)
//   - 公式コミュ管理者が脱退しても official_admin_user_id が残り、
//     attachOfficialAuthor で de-anonymize が継続する
// → 本関数で role / 公式 admin を検査して、危険なケースは block する。
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

// ============================================================
// realtime: 自分の community_members 変更を購読
// ============================================================
// 自分が join / leave した時に listener が呼ばれる。React Query 等の cache 無効化に使う。
export function subscribeToMyCommunityChanges(
  userId: string,
  onChange: () => void,
): { unsubscribe: () => void } {
  const channel = supabase
    .channel(`my-communities:${userId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'community_members', filter: `user_id=eq.${userId}` },
      () => onChange(),
    )
    .subscribe();
  return {
    unsubscribe: () => {
      try { supabase.removeChannel(channel); } catch { /* ignore */ }
    },
  };
}
