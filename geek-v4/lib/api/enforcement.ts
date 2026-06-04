// ============================================================
// lib/api/enforcement.ts — 段階的措置(enforcement_actions) + 異議(appeals) API
// ------------------------------------------------------------
// migration 0122 の RPC / テーブルをラップする。
//   - applyEnforcement(): 警告/機能制限/一時停止/永久BAN を適用(admin)
//   - fetchEnforcementHistory(): ユーザーの措置履歴
//   - fetchActiveStrikeCount(): 失効していない strike(level<=1) 数
//   - fetchAppeals() / reviewAppeal(): 異議の一覧・審査(admin)
//
// 0122 未適用環境では RPC/テーブルが無いため throw する。呼び出し側(UI)は
// try/catch でガードするか、0122 適用後に有効化する想定。
// ============================================================
import { supabase } from '../supabase';

export type EnforcementLevel = 0 | 1 | 2 | 3;

export const ENFORCEMENT_LABELS: Record<EnforcementLevel, string> = {
  0: '警告',
  1: '機能制限',
  2: '一時停止',
  3: '永久BAN',
};

export type EnforcementAction = {
  id: string;
  user_id: string;
  level: number;
  scope: string;
  reason: string;
  policy_ref: string | null;
  issued_by: string | null;
  issued_at: string;
  expires_at: string | null;
  linked_case_id: string | null;
  created_at: string;
};

export type AppealStatus = 'pending' | 'approved' | 'denied';

export type Appeal = {
  id: string;
  action_id: string;
  user_id: string;
  message: string;
  status: AppealStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  decision_note: string | null;
  created_at: string;
};

/** 措置を適用 (admin)。重大違反は level=3 を直接渡せば即 BAN(累積待ちなし)。 */
export async function applyEnforcement(args: {
  userId: string;
  level: EnforcementLevel;
  scope?: string;
  reason?: string;
  caseId?: string | null;
  expiresAt?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc('apply_enforcement', {
    p_user_id: args.userId,
    p_level: args.level,
    p_scope: args.scope ?? 'global',
    p_reason: args.reason ?? '',
    p_case_id: args.caseId ?? null,
    p_expires_at: args.expiresAt ?? null,
  });
  if (error) throw error;
  return data as string;
}

/** ユーザーの措置履歴 (新しい順)。RLS: admin 全 / 本人は自分のみ。 */
export async function fetchEnforcementHistory(userId: string): Promise<EnforcementAction[]> {
  const { data, error } = await supabase
    .from('enforcement_actions')
    .select('*')
    .eq('user_id', userId)
    .order('issued_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as EnforcementAction[];
}

/** 失効していない strike(level<=1) 数。失敗時は 0 (措置UIをブロックしない)。 */
export async function fetchActiveStrikeCount(userId: string): Promise<number> {
  const { data, error } = await supabase.rpc('active_strike_count', { p_user_id: userId });
  if (error) return 0;
  return typeof data === 'number' ? data : 0;
}

/** 異議一覧 (admin)。status で絞り込み。 */
export async function fetchAppeals(status?: AppealStatus): Promise<Appeal[]> {
  let q = supabase.from('appeals').select('*').order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Appeal[];
}

/** 異議を審査 (admin)。承認/却下を記録し monitor_log に残す(RPC内)。 */
export async function reviewAppeal(appealId: string, approve: boolean, note?: string): Promise<void> {
  const { error } = await supabase.rpc('review_appeal', {
    p_appeal_id: appealId,
    p_approve: approve,
    p_note: note ?? '',
  });
  if (error) throw error;
}
