// ============================================================
// lib/api/automod — AutoMod の Supabase クエリ層 (admin 専用)
// ============================================================
// Reddit ガイド 6.4 章 — admin GUI で組み立てる自動モデレーション。
// migration 0064 (automod_rules / automod_log + posts.is_hidden) に依存。
//
// admin 以外は RLS で全 row 不可視 / 全 mutation reject。
// component から直接 supabase を叩かず、必ずこの層を経由する (CLAUDE.md 5.1)。
// ============================================================

import { supabase } from '../supabase';
import type {
  AutomodAction,
  AutomodCondition,
  AutomodRule,
} from '../utils/automodMatcher';

// ============================================================
// 型定義 (DB row の shape)
// ============================================================
export type AutomodRuleRow = {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  conditions: AutomodCondition[];
  action: AutomodAction;
  action_data: Record<string, unknown> | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  match_count: number;
  last_matched_at: string | null;
};

export type AutomodLogRow = {
  id: string;
  rule_id: string;
  post_id: string | null;
  matched_at: string;
};

// create / update の入力 (id / created_at 等は DB が埋める)
export type CreateAutomodRuleInput = {
  name: string;
  description?: string | null;
  enabled?: boolean;
  conditions: AutomodCondition[];
  action: AutomodAction;
  action_data?: Record<string, unknown> | null;
};

export type UpdateAutomodRuleInput = Partial<
  Omit<CreateAutomodRuleInput, 'name'>
> & {
  name?: string;
};

// ============================================================
// listAutomodRules — 全 rule を取得 (admin 一覧表示用)
// ============================================================
export async function listAutomodRules(opts?: {
  enabledOnly?: boolean;
  limit?: number;
}): Promise<AutomodRuleRow[]> {
  let q = supabase
    .from('automod_rules')
    .select(
      'id, name, description, enabled, conditions, action, action_data, created_by, created_at, updated_at, match_count, last_matched_at',
    )
    .order('created_at', { ascending: false })
    .limit(opts?.limit ?? 200);
  if (opts?.enabledOnly) q = q.eq('enabled', true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as AutomodRuleRow[];
}

// ============================================================
// createRule — 新規 rule を作成
// ============================================================
export async function createRule(input: CreateAutomodRuleInput): Promise<AutomodRuleRow> {
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  const uid = authData?.user?.id;
  if (!uid) throw new Error('not authenticated');

  // 軽い client-side validation (server 側でも check 制約あり)
  validateInput(input);

  const { data, error } = await supabase
    .from('automod_rules')
    .insert({
      name: input.name.trim(),
      description: input.description?.trim() ?? null,
      enabled: input.enabled ?? true,
      conditions: input.conditions,
      action: input.action,
      action_data: input.action_data ?? {},
      created_by: uid,
    })
    .select(
      'id, name, description, enabled, conditions, action, action_data, created_by, created_at, updated_at, match_count, last_matched_at',
    )
    .single();
  if (error) throw error;
  return data as AutomodRuleRow;
}

// ============================================================
// updateRule — 既存 rule を更新
// ============================================================
export async function updateRule(
  id: string,
  patch: UpdateAutomodRuleInput,
): Promise<AutomodRuleRow> {
  if (!id) throw new Error('id required');

  // name / conditions / action が含まれる時だけ軽い validation
  if (patch.conditions || patch.name || patch.action) {
    validateInput({
      name: patch.name ?? 'placeholder',
      conditions: patch.conditions ?? [
        { matcher: 'post_content', op: 'contains', value: '' },
      ],
      action: patch.action ?? 'hide',
    });
  }

  const update: Record<string, unknown> = {};
  if (patch.name !== undefined)        update.name = patch.name.trim();
  if (patch.description !== undefined) update.description = patch.description?.trim() ?? null;
  if (patch.enabled !== undefined)     update.enabled = patch.enabled;
  if (patch.conditions !== undefined)  update.conditions = patch.conditions;
  if (patch.action !== undefined)      update.action = patch.action;
  if (patch.action_data !== undefined) update.action_data = patch.action_data ?? {};

  const { data, error } = await supabase
    .from('automod_rules')
    .update(update)
    .eq('id', id)
    .select(
      'id, name, description, enabled, conditions, action, action_data, created_by, created_at, updated_at, match_count, last_matched_at',
    )
    .single();
  if (error) throw error;
  return data as AutomodRuleRow;
}

// ============================================================
// deleteRule
// ============================================================
export async function deleteRule(id: string): Promise<void> {
  if (!id) throw new Error('id required');
  const { error } = await supabase.from('automod_rules').delete().eq('id', id);
  if (error) throw error;
}

// ============================================================
// toggleRule — enabled の on/off だけ更新する小ヘルパ
// ============================================================
export async function toggleRule(id: string, enabled: boolean): Promise<void> {
  if (!id) throw new Error('id required');
  const { error } = await supabase
    .from('automod_rules')
    .update({ enabled })
    .eq('id', id);
  if (error) throw error;
}

// ============================================================
// fetchAutomodLog — 一致履歴 (admin ダッシュボード用)
// ============================================================
export async function fetchAutomodLog(opts?: {
  ruleId?: string;
  since?: string; // ISO 文字列 — 例: 24h 前
  limit?: number;
}): Promise<AutomodLogRow[]> {
  let q = supabase
    .from('automod_log')
    .select('id, rule_id, post_id, matched_at')
    .order('matched_at', { ascending: false })
    .limit(opts?.limit ?? 200);
  if (opts?.ruleId) q = q.eq('rule_id', opts.ruleId);
  if (opts?.since)  q = q.gte('matched_at', opts.since);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as AutomodLogRow[];
}

// ============================================================
// fetchAutomodStats24h — 直近 24h のマッチ件数を rule 別に集計
// ============================================================
export async function fetchAutomodStats24h(): Promise<{
  totalMatches: number;
  byRule: Record<string, number>;
}> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const logs = await fetchAutomodLog({ since, limit: 1000 });
  const byRule: Record<string, number> = {};
  for (const log of logs) {
    byRule[log.rule_id] = (byRule[log.rule_id] ?? 0) + 1;
  }
  return { totalMatches: logs.length, byRule };
}

// ============================================================
// 内部 — validation
// ============================================================
function validateInput(input: {
  name: string;
  conditions: AutomodCondition[];
  action: AutomodAction;
}): void {
  if (!input.name || input.name.trim().length === 0) {
    throw new Error('name は必須です');
  }
  if (input.name.length > 80) {
    throw new Error('name は 80 文字以内で入力してください');
  }
  if (!Array.isArray(input.conditions) || input.conditions.length === 0) {
    throw new Error('条件を 1 つ以上指定してください');
  }
  for (const c of input.conditions) {
    if (!c.matcher || !c.op) {
      throw new Error('matcher と op は必須です');
    }
    if (c.value === undefined || c.value === null) {
      throw new Error('value は必須です');
    }
  }
  if (!['hide', 'soft_warn', 'collapse', 'notify_admin'].includes(input.action)) {
    throw new Error('action が不正です');
  }
}

export type { AutomodAction, AutomodCondition, AutomodRule };
