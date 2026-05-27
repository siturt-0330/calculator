// ============================================================
// automod-eval: AutoMod rule の評価 + action 実行 Edge Function
// ============================================================
// 入力: POST { post_id: string }
// 動作:
//   1. caller が admin かチェック (実運用は postCreate trigger からも呼ぶ予定)
//   2. 対象 post を fetch (作者の age / trust_score 等を含む)
//   3. enabled=true な automod_rules を全件 fetch
//   4. 各 rule の conditions[] を AND 結合で評価
//   5. マッチした rule に対して action を実行:
//        - hide          : posts.is_hidden = true
//        - soft_warn     : notifications insert (author 宛)
//        - collapse      : tag_names に 'auto_collapsed' (action_data.tag で上書き可) を append
//        - notify_admin  : admin_messages insert (admin 全員に)
//   6. automod_log に rule_id + post_id を記録
//   7. automod_rules.match_count + last_matched_at を更新
//
// レスポンス: { matched: [{ rule_id, rule_name, action }] }
//
// 注意:
//   - service_role key を Edge 側でのみ参照 (client には絶対露出しない)
//   - CORS allowlist 方式 (_shared/cors.ts)
//   - エラー時は fail-secure: 投稿は隠さず 5xx を返すだけ
//   - **deploy は別途 (`supabase functions deploy automod-eval`)** —
//     本 file はリポジトリに追加するだけ。DB 復活後に deploy 想定。
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { buildCorsHeaders, jsonResponse } from '../_shared/cors.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================================
// 型定義 (server side — client 側 lib/utils/automodMatcher.ts と同じ shape)
// ============================================================
type Matcher =
  | 'author_age_days'
  | 'author_trust_score'
  | 'post_content'
  | 'post_tag_names'
  | 'post_is_edited';

type Op = 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'contains' | 'regex' | 'in';

type Condition = {
  matcher: Matcher;
  op: Op;
  value: number | string | string[] | boolean;
};

type Action = 'hide' | 'soft_warn' | 'collapse' | 'notify_admin';

type Rule = {
  id: string;
  name: string;
  enabled: boolean;
  conditions: Condition[];
  action: Action;
  action_data: Record<string, unknown> | null;
};

type PostCtx = {
  id: string;
  author_id: string;
  content: string;
  tag_names: string[];
  is_edited: boolean;
  // derived
  author_age_days: number;
  author_trust_score: number;
};

// ============================================================
// matcher 評価 (server side. client 版 lib/utils/automodMatcher.ts と挙動を揃える)
// ============================================================
function evalCondition(cond: Condition, ctx: PostCtx): boolean {
  const lhs = readMatcher(cond.matcher, ctx);
  return applyOp(cond.op, lhs, cond.value);
}

function readMatcher(matcher: Matcher, ctx: PostCtx): unknown {
  switch (matcher) {
    case 'author_age_days':    return ctx.author_age_days;
    case 'author_trust_score': return ctx.author_trust_score;
    case 'post_content':       return ctx.content;
    case 'post_tag_names':     return ctx.tag_names;
    case 'post_is_edited':     return ctx.is_edited;
    default:                   return undefined;
  }
}

function applyOp(op: Op, lhs: unknown, rhs: unknown): boolean {
  // number 比較
  if (op === 'lt' || op === 'lte' || op === 'gt' || op === 'gte') {
    const a = typeof lhs === 'number' ? lhs : Number(lhs);
    const b = typeof rhs === 'number' ? rhs : Number(rhs);
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    if (op === 'lt')  return a <  b;
    if (op === 'lte') return a <= b;
    if (op === 'gt')  return a >  b;
    return a >= b;
  }
  // 等価
  if (op === 'eq') {
    if (typeof lhs === 'boolean' || typeof rhs === 'boolean') {
      return Boolean(lhs) === Boolean(rhs);
    }
    if (typeof lhs === 'number' || typeof rhs === 'number') {
      return Number(lhs) === Number(rhs);
    }
    return String(lhs ?? '') === String(rhs ?? '');
  }
  // contains: 文字列 substring or 配列 inclusion
  if (op === 'contains') {
    if (Array.isArray(lhs)) {
      return lhs.map(String).includes(String(rhs));
    }
    if (typeof lhs === 'string' && typeof rhs === 'string') {
      return lhs.toLowerCase().includes(rhs.toLowerCase());
    }
    return false;
  }
  // regex (危険なので timeout 風 fail-secure)
  if (op === 'regex') {
    if (typeof lhs !== 'string' || typeof rhs !== 'string') return false;
    try {
      // 'iu' flag で大文字小文字 + Unicode 対応
      const re = new RegExp(rhs, 'iu');
      return re.test(lhs);
    } catch {
      return false;
    }
  }
  // in: rhs が array で lhs が含まれる
  if (op === 'in') {
    if (!Array.isArray(rhs)) return false;
    if (Array.isArray(lhs)) {
      // tag_names のような配列同士 → 共通要素があれば true
      const set = new Set(rhs.map(String));
      return lhs.map(String).some((v) => set.has(v));
    }
    return rhs.map(String).includes(String(lhs));
  }
  return false;
}

// 1 つの rule の全 conditions が AND で true なら matched
function evalRule(rule: Rule, ctx: PostCtx): boolean {
  if (!rule.enabled) return false;
  if (!Array.isArray(rule.conditions) || rule.conditions.length === 0) return false;
  return rule.conditions.every((c) => evalCondition(c, ctx));
}

// ============================================================
// 各 action の executor
// ============================================================
async function executeAction(
  admin: SupabaseClient,
  rule: Rule,
  post: PostCtx,
): Promise<void> {
  switch (rule.action) {
    case 'hide': {
      await admin.from('posts').update({ is_hidden: true }).eq('id', post.id);
      return;
    }
    case 'soft_warn': {
      const message =
        (rule.action_data?.['message'] as string | undefined) ??
        '自動モデレーションにより、投稿内容について注意喚起があります。';
      await admin.from('notifications').insert({
        user_id: post.author_id,
        type: 'event',
        message,
        data: { source: 'automod', rule_id: rule.id, post_id: post.id },
      });
      return;
    }
    case 'collapse': {
      const tag =
        (rule.action_data?.['tag'] as string | undefined) ?? 'auto_collapsed';
      const next = Array.from(new Set([...(post.tag_names ?? []), tag]));
      await admin.from('posts').update({ tag_names: next }).eq('id', post.id);
      return;
    }
    case 'notify_admin': {
      const title =
        (rule.action_data?.['title'] as string | undefined) ??
        `AutoMod: ${rule.name}`;
      const body =
        (rule.action_data?.['body'] as string | undefined) ??
        `Rule "${rule.name}" matched post ${post.id}.`;
      // admin 全員に DM (admin_messages.sender_id は SET NULL ref なので
      // service-role 経由なら sender_id を任意の admin に設定。ここでは
      // 最初に見つかった admin を sender にする — 「system 自動」の意味で
      // 自身宛にも届く)。
      const { data: admins } = await admin
        .from('profiles')
        .select('id')
        .eq('is_admin', true)
        .limit(50);
      const adminIds = ((admins ?? []) as Array<{ id: string }>).map((p) => p.id);
      if (adminIds.length === 0) return;
      const sender = adminIds[0];
      const rows = adminIds.map((id) => ({
        recipient_id: id,
        sender_id: sender,
        title: title.slice(0, 120),
        body: body.slice(0, 4000),
      }));
      await admin.from('admin_messages').insert(rows);
      return;
    }
  }
}

// ============================================================
// post fetch + 派生 (author_age_days, trust_score) 取得
// ============================================================
async function loadPostCtx(admin: SupabaseClient, postId: string): Promise<PostCtx | null> {
  const { data: post } = await admin
    .from('posts')
    .select('id, author_id, content, tag_names, created_at')
    .eq('id', postId)
    .maybeSingle();
  if (!post) return null;
  const row = post as {
    id: string;
    author_id: string;
    content: string;
    tag_names: string[] | null;
    created_at: string;
  };
  // is_edited: post_edits に 1 件でもあれば編集済みとみなす
  const { count: editCount } = await admin
    .from('post_edits')
    .select('id', { count: 'exact', head: true })
    .eq('post_id', postId);

  // author: created_at + trust_score
  const { data: profile } = await admin
    .from('profiles')
    .select('created_at, trust_score')
    .eq('id', row.author_id)
    .maybeSingle();
  const profRow = (profile as { created_at?: string; trust_score?: number } | null) ?? {};
  const ageMs = profRow.created_at
    ? Date.now() - new Date(profRow.created_at).getTime()
    : 0;
  const authorAgeDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
  const trustScore = typeof profRow.trust_score === 'number' ? profRow.trust_score : 0;

  return {
    id: row.id,
    author_id: row.author_id,
    content: row.content ?? '',
    tag_names: row.tag_names ?? [],
    is_edited: (editCount ?? 0) > 0,
    author_age_days: authorAgeDays,
    author_trust_score: trustScore,
  };
}

// ============================================================
// HTTP handler
// ============================================================
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: buildCorsHeaders(req) });
  }
  if (req.method !== 'POST') {
    return jsonResponse(req, { error: 'method-not-allowed' }, 405);
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return jsonResponse(req, { error: 'server-misconfigured' }, 500);
  }

  // ---- 認証 (caller が admin かどうか) ----
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return jsonResponse(req, { error: 'unauthorized' }, 401);

  const authClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userRes, error: userErr } = await authClient.auth.getUser();
  if (userErr || !userRes?.user) {
    return jsonResponse(req, { error: 'unauthorized' }, 401);
  }
  const { data: profile } = await authClient
    .from('profiles')
    .select('is_admin')
    .eq('id', userRes.user.id)
    .maybeSingle();
  const isAdmin = !!(profile as { is_admin?: boolean } | null)?.is_admin;
  if (!isAdmin) {
    return jsonResponse(req, { error: 'forbidden' }, 403);
  }

  // ---- 入力 parse ----
  let body: { post_id?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse(req, { error: 'bad-json' }, 400);
  }
  const postId = typeof body.post_id === 'string' ? body.post_id : '';
  if (!UUID_RE.test(postId)) {
    return jsonResponse(req, { error: 'bad-post-id' }, 400);
  }

  // ---- 実処理 ----
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  try {
    const ctx = await loadPostCtx(admin, postId);
    if (!ctx) return jsonResponse(req, { error: 'post-not-found' }, 404);

    const { data: rulesRaw } = await admin
      .from('automod_rules')
      .select('id, name, enabled, conditions, action, action_data')
      .eq('enabled', true);
    const rules = (rulesRaw ?? []) as Rule[];

    const matched: Array<{ rule_id: string; rule_name: string; action: Action }> = [];

    for (const rule of rules) {
      let ok = false;
      try {
        ok = evalRule(rule, ctx);
      } catch {
        // evaluator が想定外で死んでも他 rule を続行
        ok = false;
      }
      if (!ok) continue;

      try {
        await executeAction(admin, rule, ctx);
        await admin.from('automod_log').insert({ rule_id: rule.id, post_id: postId });
        // match_count + last_matched_at の更新 (atomicity は best-effort)
        await admin.rpc('increment_automod_match', { p_rule_id: rule.id }).then(
          () => undefined,
          async () => {
            // RPC 未定義環境 fallback: UPDATE
            await admin
              .from('automod_rules')
              .update({
                match_count: (await getMatchCount(admin, rule.id)) + 1,
                last_matched_at: new Date().toISOString(),
              })
              .eq('id', rule.id);
          },
        );
      } catch {
        // action 失敗は記録だけして他 rule 続行
      }

      matched.push({ rule_id: rule.id, rule_name: rule.name, action: rule.action });
    }

    return jsonResponse(req, { matched });
  } catch {
    return jsonResponse(req, { error: 'internal' }, 500);
  }
});

// fallback 用 — 現在の match_count を取得
async function getMatchCount(admin: SupabaseClient, ruleId: string): Promise<number> {
  const { data } = await admin
    .from('automod_rules')
    .select('match_count')
    .eq('id', ruleId)
    .maybeSingle();
  const n = (data as { match_count?: number } | null)?.match_count;
  return typeof n === 'number' ? n : 0;
}
