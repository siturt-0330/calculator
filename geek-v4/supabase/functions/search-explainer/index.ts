// ============================================================
// search-explainer: 検索結果の「この結果について」transparency RPC
// ============================================================
// 入力 (POST body):
//   {
//     post_id: string;          // 必須 (UUID)
//     query: string;            // 必須 (1..200 chars)
//     include_advanced?: boolean; // 任意 — true なら v4 (0097) explain も呼ぶ
//   }
//
// 出力 (200 OK 固定 — UI を壊さないため失敗時も 200 + error):
//   {
//     factors: Array<{
//       key: string;             // 'text_relevance' | 'recency' | 'eeat' |
//                                // 'history' | 'views' | 'diversity' |
//                                // 'safety_negation' | 'freshness' |
//                                // 'usability' | 'clickbait_negation' | ...
//       weight: number;          // 0..1 (UI bar の長さ)
//       contribution: number;    // signed (negation で負もありうる)
//       description: string;     // 日本語
//       category: 'positive' | 'negative' | 'neutral';
//     }>;
//     total_score: number;       // contribution の合計
//     query_intent: string;      // 'recipe' | 'qa' | 'news' | 'general' 等
//     is_personalized: boolean;  // user_search_preferences.personalization_enabled
//     advanced?: unknown;        // include_advanced=true のときだけ存在
//     error?: string;            // 失敗時にだけ存在 (factors は [])
//   }
//
// 処理:
//   1. JWT から auth.uid() を取得 (anon でも 200 を返す = 設計上 public 可)
//   2. 並列で:
//      - get_result_explanation(post_id, query)   (0086, 6 factor)
//      - get_post_safety(post_id)                  (0090, negation 用)
//      - classify_query_intent(query)              (0094, top intent)
//      - get_weights_for_query(query)              (0094, effective lambda)
//      - user_search_preferences (uid あれば)      (0086)
//      - (任意) explain_search_v4(post_id, query) (0097, 未定義環境では skip)
//   3. factor 行に effective lambda を掛けて contribution を算出
//   4. negation は signed (負)、その他は signed (正/0)
//   5. UI を壊さないため、内部例外は握って 200 + { factors:[], error } を返す
//
// 制約:
//   - Deno + Supabase Edge Function
//   - TypeScript strict、`any` 禁止 (unknown + 型ガード)
//   - CORS allowlist (_shared/cors.ts)
//   - service_role key は Edge 側でのみ参照 (client に絶対露出しない)
//   - deploy: `supabase functions deploy search-explainer` (DB 復活後)
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  createClient,
  SupabaseClient,
} from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { buildCorsHeaders, jsonResponse } from '../_shared/cors.ts';

// ============================================================
// 定数
// ============================================================
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_QUERY_LEN = 200;

// 既知の signal_key → 表示用日本語ラベル (description fallback)
// 0086/0087/0088/0090/0094 で導入された全 signal を網羅
const FACTOR_FALLBACK_DESC: Record<string, string> = {
  text_relevance: 'クエリの語が投稿のタイトル / 本文と一致しています',
  recency: '投稿の新しさを反映しています',
  eeat: '投稿者の信用スコアと評価 (いいね数) を元にした品質指標です',
  history:
    'あなたが過去に似た検索をした履歴を考慮しています',
  views: 'あなたが過去にこの投稿を閲覧した履歴を考慮しています',
  diversity:
    '特定の投稿者ばかり並ばないよう、結果を多様化しています',
  safety_negation: '安全性に関する自動シグナルにより減点されています',
  clickbait_negation: 'クリックベイト傾向のため減点されています',
  freshness: '直近 24 時間のエンゲージメント加速を加点しています',
  usability:
    'コンテンツのレイアウトやリンクの健全性などのページ体験を反映しています',
  viewed_boost: 'あなたが過去に閲覧した投稿を少しだけ優先しています',
  history_boost:
    'あなたの過去の検索類似ヒットを少しだけ優先しています',
  diversity_penalty:
    '同じ投稿者の連続表示への減点 (多様化)',
};

// negation 系の signal は contribution の符号を反転させる
// (ranking_weights 上では lambda が負だが、explain では「減点理由」なので
//  contribution として負の値を返したい)
const NEGATIVE_SIGNALS: ReadonlySet<string> = new Set([
  'safety_negation',
  'clickbait_negation',
  'diversity_penalty',
]);

// ============================================================
// 型
// ============================================================
type ReqBody = {
  post_id?: unknown;
  query?: unknown;
  include_advanced?: unknown;
};

type FactorRow = {
  key: string;
  weight: number;
  contribution: number;
  description: string;
  category: 'positive' | 'negative' | 'neutral';
};

type ExplainResp = {
  factors: FactorRow[];
  total_score: number;
  query_intent: string;
  is_personalized: boolean;
  advanced?: unknown;
  error?: string;
};

type RpcExplanationRow = {
  factor: string;
  weight: number | string;
  description: string;
};

type RpcWeightRow = {
  signal_key: string;
  effective_lambda: number | string;
};

type RpcIntentRow = {
  intent: string;
  confidence: number | string;
};

type RpcPostSafetyRow = {
  clickbait: number | string;
  spam: number | string;
  low_signal: number | string;
  concern: number | string;
  composite: number | string;
};

// ============================================================
// 入力バリデーション
// ============================================================
function validateBody(body: ReqBody): {
  post_id: string;
  query: string;
  include_advanced: boolean;
} | null {
  if (typeof body.post_id !== 'string' || !UUID_RE.test(body.post_id)) {
    return null;
  }
  if (typeof body.query !== 'string') return null;
  const q = body.query.trim();
  if (q.length === 0 || q.length > MAX_QUERY_LEN) return null;
  const includeAdvanced = body.include_advanced === true;
  return { post_id: body.post_id, query: q, include_advanced: includeAdvanced };
}

function toNum(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function classifyCategory(
  key: string,
  contribution: number,
): 'positive' | 'negative' | 'neutral' {
  if (NEGATIVE_SIGNALS.has(key) || contribution < 0) return 'negative';
  if (contribution > 0) return 'positive';
  return 'neutral';
}

// ============================================================
// RPC 呼び出し (個別に fail-safe で握りつぶす)
// ============================================================
async function fetchExplanation(
  client: SupabaseClient,
  postId: string,
  query: string,
): Promise<RpcExplanationRow[]> {
  try {
    const { data, error } = await client.rpc('get_result_explanation', {
      p_post_id: postId,
      p_query: query,
    });
    if (error) return [];
    if (!Array.isArray(data)) return [];
    const rows: RpcExplanationRow[] = [];
    for (const r of data) {
      if (r && typeof r === 'object') {
        const obj = r as Record<string, unknown>;
        const factor = obj.factor;
        if (typeof factor !== 'string') continue;
        rows.push({
          factor,
          weight: toNum(obj.weight),
          description:
            typeof obj.description === 'string' ? obj.description : '',
        });
      }
    }
    return rows;
  } catch {
    return [];
  }
}

async function fetchWeights(
  client: SupabaseClient,
  query: string,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const { data, error } = await client.rpc('get_weights_for_query', {
      p_query: query,
    });
    if (error || !Array.isArray(data)) return map;
    for (const r of data) {
      if (r && typeof r === 'object') {
        const obj = r as Record<string, unknown>;
        const key = obj.signal_key;
        if (typeof key !== 'string') continue;
        map.set(key, toNum(obj.effective_lambda));
      }
    }
  } catch {
    /* fail-safe — empty map = lambda 1.0 として扱う */
  }
  return map;
}

async function fetchTopIntent(
  client: SupabaseClient,
  query: string,
): Promise<string> {
  try {
    const { data, error } = await client.rpc('classify_query_intent', {
      p_query: query,
    });
    if (error || !Array.isArray(data) || data.length === 0) return 'general';
    let top: RpcIntentRow | null = null;
    let topConf = -1;
    for (const r of data) {
      if (r && typeof r === 'object') {
        const obj = r as Record<string, unknown>;
        const intent = obj.intent;
        if (typeof intent !== 'string') continue;
        const conf = toNum(obj.confidence);
        if (conf > topConf) {
          topConf = conf;
          top = { intent, confidence: conf };
        }
      }
    }
    return top?.intent ?? 'general';
  } catch {
    return 'general';
  }
}

async function fetchSafety(
  client: SupabaseClient,
  postId: string,
): Promise<RpcPostSafetyRow | null> {
  try {
    const { data, error } = await client.rpc('get_post_safety', {
      p_post_id: postId,
    });
    if (error || !Array.isArray(data) || data.length === 0) return null;
    const row = data[0];
    if (!row || typeof row !== 'object') return null;
    const obj = row as Record<string, unknown>;
    return {
      clickbait: toNum(obj.clickbait),
      spam: toNum(obj.spam),
      low_signal: toNum(obj.low_signal),
      concern: toNum(obj.concern),
      composite: toNum(obj.composite),
    };
  } catch {
    return null;
  }
}

async function fetchPersonalization(
  client: SupabaseClient,
  uid: string | null,
): Promise<boolean> {
  if (!uid) return false;
  try {
    const { data, error } = await client
      .from('user_search_preferences')
      .select('personalization_enabled')
      .eq('user_id', uid)
      .maybeSingle();
    if (error) return true; // 行が無い user は default = ON
    if (!data || typeof data !== 'object') return true;
    const enabled = (data as { personalization_enabled?: unknown })
      .personalization_enabled;
    return typeof enabled === 'boolean' ? enabled : true;
  } catch {
    return true;
  }
}

async function fetchAdvanced(
  client: SupabaseClient,
  postId: string,
  query: string,
): Promise<unknown> {
  // 0097 explain_search_v4 は未定義の環境 (DB に migration が未流入) でも
  // 呼んで握りつぶす設計。存在すれば contributions jsonb を含む 1 行が返る。
  try {
    const { data, error } = await client.rpc('explain_search_v4', {
      p_post_id: postId,
      p_query: query,
    });
    if (error) return null;
    return data ?? null;
  } catch {
    return null;
  }
}

// ============================================================
// factor 集計
// ============================================================
function buildFactors(
  explanation: RpcExplanationRow[],
  weights: Map<string, number>,
  safety: RpcPostSafetyRow | null,
): FactorRow[] {
  const factors: FactorRow[] = [];

  // 1) get_result_explanation の各行を contribution 化
  for (const row of explanation) {
    const key = row.factor;
    const weight = clamp01(row.weight);
    const lambda = weights.get(key) ?? 1.0;
    // contribution = weight * effective_lambda (negation は符号反転)
    let contribution = weight * lambda;
    if (NEGATIVE_SIGNALS.has(key)) {
      contribution = -Math.abs(contribution);
    }
    factors.push({
      key,
      weight,
      contribution: roundTo(contribution, 4),
      description: row.description || FACTOR_FALLBACK_DESC[key] || key,
      category: classifyCategory(key, contribution),
    });
  }

  // 2) safety_negation を別 factor として追加 (0086 explanation には含まれない)
  if (safety && safety.composite !== undefined) {
    const composite = clamp01(toNum(safety.composite));
    if (composite > 0) {
      const lambda = Math.abs(weights.get('safety_negation') ?? 0.5);
      const contribution = -(composite * lambda);
      factors.push({
        key: 'safety_negation',
        weight: composite,
        contribution: roundTo(contribution, 4),
        description: buildSafetyDescription(safety),
        category: 'negative',
      });
    }
  }

  // 3) freshness / usability / clickbait_negation など 0086 explanation には
  //    出てこないが weights に lambda が乗っている signal を「neutral 提示」で
  //    並べる (= weight 0, contribution 0)。UI 側でグレーアウト表示する想定。
  const presentKeys = new Set(factors.map((f) => f.key));
  const passiveSignals = [
    'freshness',
    'usability',
    'clickbait_negation',
  ] as const;
  for (const sk of passiveSignals) {
    if (presentKeys.has(sk)) continue;
    if (!weights.has(sk)) continue;
    factors.push({
      key: sk,
      weight: 0,
      contribution: 0,
      description:
        FACTOR_FALLBACK_DESC[sk] ?? '関連シグナル (この投稿では効いていません)',
      category: 'neutral',
    });
  }

  return factors;
}

function buildSafetyDescription(s: RpcPostSafetyRow): string {
  const parts: string[] = [];
  if (toNum(s.clickbait) > 0.3) parts.push('クリックベイト傾向');
  if (toNum(s.spam) > 0.3) parts.push('スパム傾向');
  if (toNum(s.low_signal) > 0.3) parts.push('低情報量');
  if (toNum(s.concern) > 0.3) parts.push('concern 比率が高い');
  if (parts.length === 0) {
    return '安全性シグナルにより僅かに減点されています';
  }
  return `安全性シグナル (${parts.join(' / ')}) により減点されています`;
}

function roundTo(n: number, digits: number): number {
  if (!Number.isFinite(n)) return 0;
  const k = 10 ** digits;
  return Math.round(n * k) / k;
}

// ============================================================
// HTTP handler
// ============================================================
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: buildCorsHeaders(req) });
  }
  if (req.method !== 'POST') {
    return jsonResponse(req, emptyResp('method-not-allowed'), 200);
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return jsonResponse(req, emptyResp('server-misconfigured'), 200);
  }

  // ---- 入力 parse ----
  let body: ReqBody = {};
  try {
    body = (await req.json()) as ReqBody;
  } catch {
    return jsonResponse(req, emptyResp('bad-json'), 200);
  }
  const input = validateBody(body);
  if (!input) {
    return jsonResponse(req, emptyResp('bad-input'), 200);
  }

  // ---- 認証 (なくても続行 — anon でも実行可) ----
  const authHeader = req.headers.get('Authorization') ?? '';
  // user-scoped client: get_result_explanation 内の auth.uid() を機能させるため
  // JWT を always 通す (なければ anon = uid null になる)
  const userClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    global: authHeader ? { headers: { Authorization: authHeader } } : {},
    auth: { persistSession: false },
  });

  let uid: string | null = null;
  if (authHeader) {
    try {
      const { data: userRes } = await userClient.auth.getUser();
      uid = userRes?.user?.id ?? null;
    } catch {
      uid = null;
    }
  }

  // ---- 並列 fetch (個別 fail-safe — 1 つ落ちても他は通る) ----
  try {
    const [explanation, weights, intent, safety, isPersonalized, advanced] =
      await Promise.all([
        fetchExplanation(userClient, input.post_id, input.query),
        fetchWeights(userClient, input.query),
        fetchTopIntent(userClient, input.query),
        fetchSafety(userClient, input.post_id),
        fetchPersonalization(userClient, uid),
        input.include_advanced
          ? fetchAdvanced(userClient, input.post_id, input.query)
          : Promise.resolve(null),
      ]);

    // explanation が空 = post or query が無効 / 該当無し → UI を壊さず空応答
    if (explanation.length === 0 && !safety) {
      return jsonResponse(req, {
        factors: [],
        total_score: 0,
        query_intent: intent,
        is_personalized: isPersonalized,
        error: 'no-explanation',
      } satisfies ExplainResp);
    }

    const factors = buildFactors(explanation, weights, safety);
    const totalScore = factors.reduce((acc, f) => acc + f.contribution, 0);

    const resp: ExplainResp = {
      factors,
      total_score: roundTo(totalScore, 4),
      query_intent: intent,
      is_personalized: isPersonalized,
    };
    if (input.include_advanced && advanced !== null) {
      resp.advanced = advanced;
    }
    return jsonResponse(req, resp);
  } catch {
    return jsonResponse(req, emptyResp('internal'), 200);
  }
});

function emptyResp(error: string): ExplainResp {
  return {
    factors: [],
    total_score: 0,
    query_intent: 'general',
    is_personalized: false,
    error,
  };
}
