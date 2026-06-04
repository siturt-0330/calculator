// ============================================================
// hooks/useAdminReports.ts — 通報キュー(report_cases)購読 + リアルタイム通知
// ------------------------------------------------------------
// - fetchReportQueue を React Query で購読 (queryKey ['admin','report-queue',status])
// - admin_notifications を Supabase Realtime で購読し、新着でキューを invalidate
//   → 運営者が「通報が入ったらすぐわかる」(指示書 4.4 の中核)
//
// CLAUDE.md §11 厳守:
//   - 1 channel / 1 table (admin_notifications のみ。連鎖死を避ける)
//   - admin_notifications は migration 0121 で publication 登録済み。
//     0121 未適用環境では CHANNEL_ERROR になるが、その channel が死ぬだけで
//     polling(staleTime/refetch)に degrade する (best-effort)。
// ============================================================
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { attachChannel } from '../lib/realtime';
import {
  fetchReportQueue,
  type ReportCase,
  type ReportCaseStatus,
} from '../lib/api/adminReports';

export type UseReportQueueResult = {
  cases: ReportCase[];
  /** RPC 未適用で concern 集計 fallback を使ったか (true なら assign/resolve 不可) */
  usedFallback: boolean;
  /** 未対応(open)件数 — ダッシュボードのバッジ用 */
  openCount: number;
  isLoading: boolean;
  isFetching: boolean;
  refetch: () => void;
};

export function useReportQueue(
  status: ReportCaseStatus | 'all' = 'open',
): UseReportQueueResult {
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ['admin', 'report-queue', status],
    queryFn: () => fetchReportQueue({ status }),
    // 通報は鮮度重視だが、realtime invalidate が主経路なので polling は控えめに。
    staleTime: 15_000,
  });

  // admin_notifications の INSERT を realtime 購読 → キューを invalidate。
  useEffect(() => {
    const detach = attachChannel(
      'admin-feed:notifications',
      (ch) =>
        ch.on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'admin_notifications' },
          () => {
            // status 違いの全キャッシュをまとめて無効化 (prefix match)
            void qc.invalidateQueries({ queryKey: ['admin', 'report-queue'] });
          },
        ),
      (st, err) => {
        // publication 未登録(0121未適用)だと CHANNEL_ERROR。polling に degrade。
        if (st === 'CHANNEL_ERROR') {
          // eslint-disable-next-line no-console
          console.warn('[admin-feed] CHANNEL_ERROR (admin_notifications 未publication?)', err?.message);
        }
      },
    );
    return () => {
      try {
        detach();
      } catch {
        /* cleanup 失敗は無視 */
      }
    };
  }, [qc]);

  const cases = q.data?.cases ?? [];
  const usedFallback = q.data?.usedFallback ?? false;
  const openCount = cases.filter((c) => c.status === 'open').length;

  return {
    cases,
    usedFallback,
    openCount,
    isLoading: q.isLoading,
    isFetching: q.isFetching,
    refetch: () => {
      void q.refetch();
    },
  };
}
