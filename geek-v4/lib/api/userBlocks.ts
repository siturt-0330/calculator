// ============================================================
// userBlocks.ts — migration 0143 の block RPC 薄ラッパー
// ============================================================
// block_pseudonym / unblock_pseudonym / get_blocked_pseudonyms の
// 3 RPC を呼び出す。呼び出し側は React Query mutation / query に
// このファイルの関数を渡す (component から supabase を直叩きしない規約)。
// ============================================================

import { supabase } from '../supabase';
import { withApiTimeout } from '../withApiTimeout';

export type BlockedUser = {
  pseudonymId: string;
  reason: string | null;
  createdAt: string;
};

/** get_blocked_pseudonyms RPC が返す行の型 */
type BlockedPseudonymRow = {
  pseudonym_id: string;
  reason: string | null;
  created_at: string;
};

/**
 * 指定した仮名 ID をブロックする。
 *
 * @param pseudonymId ブロック対象の pseudonym_id
 * @param reason ブロック理由 (省略時は 'other')
 * @returns 成功時 true
 * @throws Supabase エラーまたはタイムアウト時
 */
export async function blockUser(
  pseudonymId: string,
  reason?: 'spam' | 'harassment' | 'other',
): Promise<boolean> {
  const { error } = await withApiTimeout(
    supabase.rpc('block_pseudonym', {
      p_pseudonym_id: pseudonymId,
      p_reason: reason ?? 'other',
    }),
    'userBlocks.block',
  );
  if (error) throw error;
  return true;
}

/**
 * 指定した仮名 ID のブロックを解除する。
 *
 * @param pseudonymId ブロック解除対象の pseudonym_id
 * @returns 成功時 true
 * @throws Supabase エラーまたはタイムアウト時
 */
export async function unblockUser(pseudonymId: string): Promise<boolean> {
  const { error } = await withApiTimeout(
    supabase.rpc('unblock_pseudonym', {
      p_pseudonym_id: pseudonymId,
    }),
    'userBlocks.unblock',
  );
  if (error) throw error;
  return true;
}

/**
 * 自分がブロックしている仮名一覧を取得する。
 *
 * @returns BlockedUser の配列
 * @throws Supabase エラーまたはタイムアウト時
 */
export async function getBlockedUsers(): Promise<BlockedUser[]> {
  const { data, error } = await withApiTimeout(
    supabase.rpc('get_blocked_pseudonyms'),
    'userBlocks.getBlocked',
  );
  if (error) throw error;
  if (!data) return [];

  return (data as BlockedPseudonymRow[]).map((row) => ({
    pseudonymId: row.pseudonym_id,
    reason: row.reason,
    createdAt: row.created_at,
  }));
}
