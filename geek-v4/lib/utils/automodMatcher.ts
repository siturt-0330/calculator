// ============================================================
// automodMatcher — pure 関数で AutoMod ルールを評価
// ============================================================
// Reddit ガイド 6.4 章 / Reddit ガイド #8 — admin が GUI で組み立てた
// ルールを post に対して評価する。クライアント側 dry-run / unit test 用。
//
// 同等の評価ロジックは supabase/functions/automod-eval/index.ts にも
// 存在する (server 側は service-role で post fetch + action 実行も担う)。
// 2 実装が drift しないよう、本 file の挙動を「正」として server を揃える。
// ============================================================

export type AutomodMatcher =
  | 'author_age_days'
  | 'author_trust_score'
  | 'post_content'
  | 'post_tag_names'
  | 'post_is_edited';

export type AutomodOp =
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'eq'
  | 'contains'
  | 'regex'
  | 'in';

export type AutomodValue = number | string | string[] | boolean;

export type AutomodCondition = {
  matcher: AutomodMatcher;
  op: AutomodOp;
  value: AutomodValue;
};

export type AutomodAction = 'hide' | 'soft_warn' | 'collapse' | 'notify_admin';

export type AutomodRule = {
  id?: string;
  name?: string;
  enabled?: boolean;
  conditions: AutomodCondition[];
  action: AutomodAction;
  action_data?: Record<string, unknown> | null;
};

export type AutomodPostCtx = {
  author_age_days: number;
  author_trust_score: number;
  content: string;
  tag_names: string[];
  is_edited: boolean;
};

// ============================================================
// matcher 読み出し
// ============================================================
function readMatcher(
  matcher: AutomodMatcher,
  ctx: AutomodPostCtx,
): number | string | string[] | boolean | undefined {
  switch (matcher) {
    case 'author_age_days':    return ctx.author_age_days;
    case 'author_trust_score': return ctx.author_trust_score;
    case 'post_content':       return ctx.content;
    case 'post_tag_names':     return ctx.tag_names;
    case 'post_is_edited':     return ctx.is_edited;
    default:                   return undefined;
  }
}

// ============================================================
// op 適用
// ============================================================
function applyOp(op: AutomodOp, lhs: unknown, rhs: unknown): boolean {
  if (op === 'lt' || op === 'lte' || op === 'gt' || op === 'gte') {
    const a = typeof lhs === 'number' ? lhs : Number(lhs);
    const b = typeof rhs === 'number' ? rhs : Number(rhs);
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    if (op === 'lt')  return a <  b;
    if (op === 'lte') return a <= b;
    if (op === 'gt')  return a >  b;
    return a >= b;
  }

  if (op === 'eq') {
    if (typeof lhs === 'boolean' || typeof rhs === 'boolean') {
      return Boolean(lhs) === Boolean(rhs);
    }
    if (typeof lhs === 'number' || typeof rhs === 'number') {
      return Number(lhs) === Number(rhs);
    }
    return String(lhs ?? '') === String(rhs ?? '');
  }

  if (op === 'contains') {
    if (Array.isArray(lhs)) {
      return lhs.map(String).includes(String(rhs));
    }
    if (typeof lhs === 'string' && typeof rhs === 'string') {
      return lhs.toLowerCase().includes(rhs.toLowerCase());
    }
    return false;
  }

  if (op === 'regex') {
    if (typeof lhs !== 'string' || typeof rhs !== 'string') return false;
    try {
      const re = new RegExp(rhs, 'iu');
      return re.test(lhs);
    } catch {
      return false;
    }
  }

  if (op === 'in') {
    if (!Array.isArray(rhs)) return false;
    if (Array.isArray(lhs)) {
      // 配列同士 → 共通要素があれば true
      const set = new Set(rhs.map(String));
      return lhs.map(String).some((v) => set.has(v));
    }
    return rhs.map(String).includes(String(lhs));
  }

  return false;
}

// ============================================================
// 公開 API
// ============================================================

/**
 * 1 つの condition を評価。
 * 不正な matcher / op は false (fail-secure)。
 */
export function evalCondition(
  cond: AutomodCondition,
  ctx: AutomodPostCtx,
): boolean {
  const lhs = readMatcher(cond.matcher, ctx);
  return applyOp(cond.op, lhs, cond.value);
}

/**
 * 1 つの rule を評価。
 * - rule.enabled === false → 常に false
 * - conditions[] が空 → false (誤発火防止)
 * - 全 conditions が true (AND) で true
 * - evaluator 内例外は false (個別 condition で握る)
 */
export function evalRule(rule: AutomodRule, ctx: AutomodPostCtx): { matched: boolean } {
  if (rule.enabled === false) return { matched: false };
  if (!Array.isArray(rule.conditions) || rule.conditions.length === 0) {
    return { matched: false };
  }
  try {
    const matched = rule.conditions.every((c) => evalCondition(c, ctx));
    return { matched };
  } catch {
    return { matched: false };
  }
}

/**
 * 複数 rule をまとめて評価し、マッチしたものだけ返す。
 */
export function evalAllRules(
  rules: AutomodRule[],
  ctx: AutomodPostCtx,
): AutomodRule[] {
  return rules.filter((r) => evalRule(r, ctx).matched);
}
