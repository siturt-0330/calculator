// ============================================================
// useAutomodRules — AutoMod ルールの React Query hooks (admin 専用)
// ============================================================
// Reddit ガイド 6.4 章 — admin が GUI で組み立てるルール群を取得 / 編集する。
// 全 mutation は invalidate で list と stats を refresh。
// ============================================================

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listAutomodRules,
  createRule,
  updateRule,
  deleteRule,
  toggleRule,
  fetchAutomodLog,
  fetchAutomodStats24h,
  type AutomodRuleRow,
  type CreateAutomodRuleInput,
  type UpdateAutomodRuleInput,
} from '../lib/api/automod';
import { useToastStore } from '../stores/toastStore';

// ---- query keys (1 箇所に集約しておくと invalidate 漏れを防げる) ----
const KEYS = {
  rules: ['automod-rules'] as const,
  stats24h: ['automod-stats-24h'] as const,
  log: (ruleId?: string) =>
    ruleId ? (['automod-log', ruleId] as const) : (['automod-log'] as const),
};

// ============================================================
// useAutomodRules — 一覧
// ============================================================
export function useAutomodRules(opts?: { enabledOnly?: boolean }) {
  const q = useQuery({
    queryKey: [...KEYS.rules, { enabledOnly: !!opts?.enabledOnly }],
    queryFn: () => listAutomodRules(opts),
    staleTime: 30_000,
  });
  return {
    rules: (q.data ?? []) as AutomodRuleRow[],
    isLoading: q.isLoading,
    error: q.error,
    refetch: q.refetch,
  };
}

// ============================================================
// useAutomodStats24h — 直近 24h の rule 別マッチ件数
// ============================================================
export function useAutomodStats24h() {
  return useQuery({
    queryKey: KEYS.stats24h,
    queryFn: fetchAutomodStats24h,
    staleTime: 60_000,
  });
}

// ============================================================
// useAutomodLog — 履歴 (rule 単位 / 全体)
// ============================================================
export function useAutomodLog(ruleId?: string) {
  return useQuery({
    queryKey: KEYS.log(ruleId),
    queryFn: () => fetchAutomodLog({ ruleId, limit: 100 }),
    staleTime: 30_000,
  });
}

// ============================================================
// useCreateAutomodRule
// ============================================================
export function useCreateAutomodRule() {
  const qc = useQueryClient();
  const show = useToastStore((s) => s.show);
  return useMutation({
    mutationFn: (input: CreateAutomodRuleInput) => createRule(input),
    onSuccess: () => {
      show('ルールを追加しました', 'success');
      void qc.invalidateQueries({ queryKey: KEYS.rules });
      void qc.invalidateQueries({ queryKey: KEYS.stats24h });
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : '追加に失敗しました';
      show(msg, 'error');
    },
  });
}

// ============================================================
// useUpdateAutomodRule
// ============================================================
export function useUpdateAutomodRule() {
  const qc = useQueryClient();
  const show = useToastStore((s) => s.show);
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateAutomodRuleInput }) =>
      updateRule(id, patch),
    onSuccess: () => {
      show('ルールを更新しました', 'success');
      void qc.invalidateQueries({ queryKey: KEYS.rules });
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : '更新に失敗しました';
      show(msg, 'error');
    },
  });
}

// ============================================================
// useDeleteAutomodRule
// ============================================================
export function useDeleteAutomodRule() {
  const qc = useQueryClient();
  const show = useToastStore((s) => s.show);
  return useMutation({
    mutationFn: (id: string) => deleteRule(id),
    onSuccess: () => {
      show('ルールを削除しました', 'warn');
      void qc.invalidateQueries({ queryKey: KEYS.rules });
      void qc.invalidateQueries({ queryKey: KEYS.stats24h });
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : '削除に失敗しました';
      show(msg, 'error');
    },
  });
}

// ============================================================
// useToggleAutomodRule — 有効/無効の即時切替 (optimistic update)
// ============================================================
export function useToggleAutomodRule() {
  const qc = useQueryClient();
  const show = useToastStore((s) => s.show);
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      toggleRule(id, enabled),
    onMutate: async ({ id, enabled }) => {
      // optimistic: 既存の list cache を書き換える
      await qc.cancelQueries({ queryKey: KEYS.rules });
      const snapshots = qc.getQueriesData<AutomodRuleRow[]>({ queryKey: KEYS.rules });
      for (const [key, list] of snapshots) {
        if (!Array.isArray(list)) continue;
        qc.setQueryData<AutomodRuleRow[]>(
          key,
          list.map((r) => (r.id === id ? { ...r, enabled } : r)),
        );
      }
      return { snapshots };
    },
    onError: (e, _vars, ctx) => {
      // revert
      if (ctx?.snapshots) {
        for (const [key, snap] of ctx.snapshots) {
          qc.setQueryData(key, snap);
        }
      }
      const msg = e instanceof Error ? e.message : '切替に失敗しました';
      show(msg, 'error');
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: KEYS.rules });
    },
  });
}
