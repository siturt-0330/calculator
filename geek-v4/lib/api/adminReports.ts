// ============================================================
// lib/api/adminReports.ts — 通報ケース(report_cases)の admin API
// ------------------------------------------------------------
// migration 0118_report_cases.sql の RPC をラップする:
//   - get_report_queue(p_status, p_limit) → 優先度順の通報キュー
//   - assign_report_case(p_case_id, p_assignee) → 担当アサイン
//   - resolve_report_case(p_case_id, p_resolution, p_reason) → 解決/却下
//
// フォールバック設計 (CLAUDE.md §11 / ADMIN_CONSOLE.md):
//   0118 未適用の本番/CI でも壊れないよう、RPC が無い(PGRST202)ときは
//   既存 admin_reported_posts_v(concern 集計) ベースの fetchReportedPosts に
//   自動フォールバックする。fallback 時の case は id が 'fallback:<post_id>' に
//   なり、assign/resolve は呼べない(UI 側で usedFallback を見て無効化する)。
// ============================================================
import { supabase } from '../supabase';
import { withApiTimeout } from '../withApiTimeout';
import { fetchReportedPosts, type AdminReportedPost } from './admin';

export type ReportCaseStatus = 'open' | 'triaged' | 'in_review' | 'resolved' | 'rejected';
export type ReportSeverity = 'critical' | 'high' | 'medium' | 'low';
export type ReportResolution = 'content_removed' | 'user_actioned' | 'no_action' | 'duplicate';

export type ReportCasePost = {
  id: string;
  content: string;
  author_id: string | null;
  visibility: string;
  created_at: string;
  likes_count: number;
  concern_count: number;
};

export type ReportCase = {
  id: string;
  target_type: string;
  target_id: string;
  status: ReportCaseStatus;
  severity: ReportSeverity;
  report_count: number;
  reasons: string[];
  assignee_id: string | null;
  first_reported_at: string;
  last_reported_at: string;
  resolved_at: string | null;
  resolution: ReportResolution | null;
  /** server 算出の優先度スコア(大きいほど優先)。fallback では report_count。 */
  prio: number;
  post: ReportCasePost | null;
};

// RPC がスキーマに無い (= migration 未適用) ことを判定する。
function isRpcMissing(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  if (e.code === 'PGRST202') return true; // function not found in schema cache
  const msg = e.message ?? '';
  return /function .*does not exist|could not find the function/i.test(msg);
}

/**
 * 通報キューを優先度順に取得。
 * @returns cases と、RPC 未適用で fallback したかの usedFallback。
 */
export async function fetchReportQueue(opts?: {
  status?: ReportCaseStatus | 'all';
  limit?: number;
}): Promise<{ cases: ReportCase[]; usedFallback: boolean }> {
  const status = opts?.status ?? 'open';
  const limit = opts?.limit ?? 50;
  try {
    const { data, error } = await withApiTimeout(
      supabase.rpc('get_report_queue', {
        p_status: status,
        p_limit: limit,
      }),
      'adminReports.queue',
      8000,
    );
    if (error) {
      if (isRpcMissing(error)) return { cases: await fallbackQueue(limit), usedFallback: true };
      throw error;
    }
    if (!Array.isArray(data)) {
      // RPC は在るのに配列以外が返った異常系。空表示で握り潰さず観測可能にする。
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[adminReports] get_report_queue returned non-array:', typeof data);
      }
      return { cases: [], usedFallback: false };
    }
    return { cases: data as ReportCase[], usedFallback: false };
  } catch (e) {
    if (isRpcMissing(e)) return { cases: await fallbackQueue(limit), usedFallback: true };
    throw e;
  }
}

// 0118 未適用環境向け: 既存 admin_reported_posts_v(concern 集計) を ReportCase 形に変換。
async function fallbackQueue(limit: number): Promise<ReportCase[]> {
  const reported: AdminReportedPost[] = await fetchReportedPosts({ minReports: 1, limit });
  return reported.map((r) => ({
    id: `fallback:${r.post_id}`,
    target_type: 'post',
    target_id: r.post_id,
    status: 'open',
    severity: 'low',
    report_count: r.reports_count,
    reasons: [],
    assignee_id: null,
    first_reported_at: r.last_reported_at,
    last_reported_at: r.last_reported_at,
    resolved_at: null,
    resolution: null,
    prio: r.reports_count,
    post: {
      id: r.post_id,
      content: r.content,
      author_id: r.author_id,
      visibility: r.visibility,
      created_at: r.post_created_at,
      likes_count: r.likes_count,
      concern_count: r.concern_count,
    },
  }));
}

/** 通報ケースに担当をアサイン (省略時は自分)。0118 RPC が前提。 */
export async function assignReportCase(caseId: string, assignee?: string | null): Promise<void> {
  const { error } = await withApiTimeout(
    supabase.rpc('assign_report_case', {
      p_case_id: caseId,
      p_assignee: assignee ?? null,
    }),
    'adminReports.assign',
    8000,
  );
  if (error) throw error;
}

/** 通報ケースを解決/却下し、監査ログに記録 (RPC 内で moderation_log へ insert)。 */
export async function resolveReportCase(
  caseId: string,
  resolution: ReportResolution,
  reason?: string,
): Promise<void> {
  const { error } = await withApiTimeout(
    supabase.rpc('resolve_report_case', {
      p_case_id: caseId,
      p_resolution: resolution,
      p_reason: reason ?? '',
    }),
    'adminReports.resolve',
    8000,
  );
  if (error) throw error;
}
