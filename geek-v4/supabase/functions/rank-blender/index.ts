// ============================================================
// rank-blender: 検索 ranking の lambda blending Edge Function
// ============================================================
// 目的:
//   A/B group ごとに異なる task weight profile を切り替えて、
//   client から渡された (query, post_ids, signals) に対して
//   blended score を計算して返す HTTP endpoint。
//
//   SQL でやると weight tuning が硬く、profile を増やすたびに
//   migration を追加することになるので、Edge 側に持ってきて
//   軽量に組み替えられるようにする。
//
// 入力 (POST JSON):
//   {
//     query: string,                       // 検索クエリ (現状は log 用のみ、計算には未使用)
//     post_ids: string[],                  // 並べ替え対象の post id
//     ab_group?: string,                   // 任意 — 省略時は user_ab_assignment 参照
//     signals: {
//       [post_id: string]: {
//         text_relevance?: number,
//         recency?: number,
//         eeat?: number,
//         usability?: number,
//         viewed_boost?: number,
//         history_boost?: number,
//         safety_negation?: number,
//         clickbait_negation?: number,
//         freshness?: number,
//         diversity_penalty?: number,
//         [signal_key: string]: number | undefined,
//       }
//     }
//   }
//
// 出力:
//   {
//     results: Array<{
//       post_id: string,
//       final_score: number,
//       contributions: Record<string, number>,  // signal_key -> 寄与点
//     }>,
//     ab_group: string,
//     profile_name: string,
//   }
//
// 処理:
//   1. Authorization ヘッダから auth.uid() を取得 (未認証は anon)
//   2. ab_group 指定があれば ab_group_profile_map で profile 解決、
//      無ければ get_active_ranking_weights() を auth-forwarding client で呼ぶ
//   3. 各 post について signal × lambda を加算
//      - |signal| < threshold は drop (TIES sparsification 相当)
//      - signal が未指定なら 0
//   4. final_score の降順に sort
//   5. CORS preflight 対応
//
// 非機能:
//   - TypeScript strict, any 禁止
//   - エラーは JSON で 400 / 401 / 500
//   - service_role key は env から、client には絶対露出しない
//   - rate limit は client 側に任せる (本 fn は idempotent な計算のみ)
//   - 0088 が定義する get_active_ranking_weights() を素直に使う
//
// deploy:
//   supabase functions deploy rank-blender
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  createClient,
  SupabaseClient,
} from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { buildCorsHeaders, jsonResponse } from '../_shared/cors.ts';

// ============================================================
// 型定義
// ============================================================
type SignalMap = Record<string, number | undefined>;

type RequestBody = {
  query?: unknown;
  post_ids?: unknown;
  ab_group?: unknown;
  signals?: unknown;
};

type ValidatedInput = {
  query: string;
  postIds: string[];
  abGroup: string | null;
  signals: Record<string, SignalMap>;
};

type WeightRow = {
  signal_key: string;
  lambda: number;
  threshold: number;
};

type WeightLookup = {
  profileName: string;
  weights: ReadonlyMap<string, { lambda: number; threshold: number }>;
};

type RankedResult = {
  post_id: string;
  final_score: number;
  contributions: Record<string, number>;
};

// ============================================================
// 定数
// ============================================================
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_POST_IDS = 500;
const MAX_QUERY_LEN = 1_000;
const MAX_AB_GROUP_LEN = 64;
const DEFAULT_PROFILE_NAME = 'default';
const ANON_AB_GROUP = 'anon';
const FALLBACK_AB_GROUP = 'default';

// ============================================================
// 入力 validate
// ============================================================
function validateInput(raw: unknown): ValidatedInput | { error: string } {
  if (!raw || typeof raw !== 'object') {
    return { error: 'body must be a JSON object' };
  }
  const body = raw as RequestBody;

  // query
  if (typeof body.query !== 'string') {
    return { error: 'query must be string' };
  }
  if (body.query.length > MAX_QUERY_LEN) {
    return { error: 'query too long' };
  }

  // post_ids
  if (!Array.isArray(body.post_ids)) {
    return { error: 'post_ids must be array' };
  }
  if (body.post_ids.length === 0) {
    return { error: 'post_ids must be non-empty' };
  }
  if (body.post_ids.length > MAX_POST_IDS) {
    return { error: `post_ids too many (max ${MAX_POST_IDS})` };
  }
  const postIds: string[] = [];
  for (const id of body.post_ids) {
    if (typeof id !== 'string' || !UUID_RE.test(id)) {
      return { error: 'post_ids must be array of uuid strings' };
    }
    postIds.push(id);
  }

  // ab_group (optional)
  let abGroup: string | null = null;
  if (body.ab_group !== undefined && body.ab_group !== null) {
    if (typeof body.ab_group !== 'string') {
      return { error: 'ab_group must be string' };
    }
    const trimmed = body.ab_group.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_AB_GROUP_LEN) {
      return {
        error: `ab_group length must be 1..${MAX_AB_GROUP_LEN}`,
      };
    }
    abGroup = trimmed;
  }

  // signals
  if (!body.signals || typeof body.signals !== 'object' || Array.isArray(body.signals)) {
    return { error: 'signals must be object' };
  }
  const signalsRaw = body.signals as Record<string, unknown>;
  const signals: Record<string, SignalMap> = {};
  for (const postId of postIds) {
    const entry = signalsRaw[postId];
    if (entry === undefined) {
      signals[postId] = {};
      continue;
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { error: `signals['${postId}'] must be object` };
    }
    const map: SignalMap = {};
    for (const [key, val] of Object.entries(entry as Record<string, unknown>)) {
      if (typeof val === 'number' && Number.isFinite(val)) {
        map[key] = val;
      } else if (val === null || val === undefined) {
        // skip
      } else {
        return {
          error: `signals['${postId}']['${key}'] must be finite number`,
        };
      }
    }
    signals[postId] = map;
  }

  return { query: body.query, postIds, abGroup, signals };
}

// ============================================================
// weight 解決
// ============================================================
// 1. ab_group が input にあれば ab_group_profile_map から profile_id 解決
//    (見つからなければ次へ fall through)
// 2. それ以外は auth-forwarding client で get_active_ranking_weights() を呼ぶ
//    (0088 の RPC が auth.uid() ベースで ab_group → profile 解決を内蔵)
// 3. 全部空 → default profile を直接読む
// ============================================================
async function resolveWeightsByAbGroup(
  admin: SupabaseClient,
  abGroup: string,
): Promise<WeightLookup | null> {
  const { data: mapRow } = await admin
    .from('ab_group_profile_map')
    .select('profile_id')
    .eq('ab_group', abGroup)
    .maybeSingle();
  const profileId = (mapRow as { profile_id?: string } | null)?.profile_id;
  if (!profileId) return null;
  return loadWeightsByProfileId(admin, profileId);
}

async function loadWeightsByProfileId(
  admin: SupabaseClient,
  profileId: string,
): Promise<WeightLookup | null> {
  const { data: profileRow } = await admin
    .from('ranking_weight_profiles')
    .select('profile_name')
    .eq('id', profileId)
    .maybeSingle();
  const profileName =
    (profileRow as { profile_name?: string } | null)?.profile_name ?? null;
  if (!profileName) return null;

  const { data: rows } = await admin
    .from('ranking_weights')
    .select('signal_key, lambda, threshold')
    .eq('profile_id', profileId)
    .eq('active', true);
  const list = (rows ?? []) as WeightRow[];
  return { profileName, weights: toWeightMap(list) };
}

async function loadDefaultWeights(
  admin: SupabaseClient,
): Promise<WeightLookup | null> {
  const { data: profileRow } = await admin
    .from('ranking_weight_profiles')
    .select('id, profile_name')
    .eq('profile_name', DEFAULT_PROFILE_NAME)
    .maybeSingle();
  const id = (profileRow as { id?: string } | null)?.id;
  if (!id) return null;
  return loadWeightsByProfileId(admin, id);
}

// auth-forwarding client で get_active_ranking_weights() を呼ぶ。
// RPC 自体は (signal_key, lambda, threshold) を返すだけで profile_name を返さないので、
// 別途 active profile を引いて name を取る。
async function resolveWeightsFromActiveProfile(
  authClient: SupabaseClient,
  admin: SupabaseClient,
): Promise<WeightLookup | null> {
  const { data: rpcData, error: rpcErr } = await authClient.rpc(
    'get_active_ranking_weights',
  );
  if (rpcErr) {
    return null;
  }
  const rows = (rpcData ?? []) as WeightRow[];
  if (rows.length === 0) return null;

  // profile_name 取得: 単純に is_active=true なものを引く。
  // 見つからなければ default を採用。
  const { data: active } = await admin
    .from('ranking_weight_profiles')
    .select('profile_name')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  const profileName =
    (active as { profile_name?: string } | null)?.profile_name ??
    DEFAULT_PROFILE_NAME;
  return { profileName, weights: toWeightMap(rows) };
}

function toWeightMap(
  rows: ReadonlyArray<WeightRow>,
): ReadonlyMap<string, { lambda: number; threshold: number }> {
  const m = new Map<string, { lambda: number; threshold: number }>();
  for (const r of rows) {
    const lambda = Number(r.lambda);
    const threshold = Number(r.threshold);
    if (!Number.isFinite(lambda) || !Number.isFinite(threshold)) continue;
    m.set(r.signal_key, { lambda, threshold });
  }
  return m;
}

// ============================================================
// blending
// ============================================================
function blend(
  postIds: ReadonlyArray<string>,
  signals: Record<string, SignalMap>,
  weights: ReadonlyMap<string, { lambda: number; threshold: number }>,
): RankedResult[] {
  const out: RankedResult[] = [];
  for (const postId of postIds) {
    const sig = signals[postId] ?? {};
    const contributions: Record<string, number> = {};
    let final = 0;

    for (const [signalKey, w] of weights) {
      const raw = sig[signalKey];
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        // 未提供 signal は寄与 0、contributions にも出さない (output を軽くする)
        continue;
      }
      // sparsification: |signal| < threshold は drop
      if (Math.abs(raw) < w.threshold) {
        continue;
      }
      const contribution = raw * w.lambda;
      if (contribution === 0) continue;
      contributions[signalKey] = contribution;
      final += contribution;
    }

    out.push({ post_id: postId, final_score: final, contributions });
  }
  // 降順 sort (final_score 同点なら post_id 昇順で安定化)
  out.sort((a, b) => {
    if (b.final_score !== a.final_score) return b.final_score - a.final_score;
    return a.post_id < b.post_id ? -1 : a.post_id > b.post_id ? 1 : 0;
  });
  return out;
}

// ============================================================
// caller の ab_group を user_ab_assignment から取得
// (input.ab_group 指定が無く、かつ RPC 経路を取らない場合の表示用)
// ============================================================
async function lookupCallerAbGroup(
  admin: SupabaseClient,
  userId: string | null,
): Promise<string> {
  if (!userId) return ANON_AB_GROUP;
  const { data } = await admin
    .from('user_ab_assignment')
    .select('ab_group')
    .eq('user_id', userId)
    .maybeSingle();
  const g = (data as { ab_group?: string } | null)?.ab_group;
  return typeof g === 'string' && g.length > 0 ? g : FALLBACK_AB_GROUP;
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

  // ---- 入力 parse ----
  let rawBody: unknown = null;
  try {
    rawBody = await req.json();
  } catch {
    return jsonResponse(req, { error: 'bad-json' }, 400);
  }
  const validated = validateInput(rawBody);
  if ('error' in validated) {
    return jsonResponse(req, { error: validated.error }, 400);
  }
  const { postIds, abGroup: requestedAbGroup, signals } = validated;

  // ---- auth: caller user 解決 (anon は許可) ----
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const authHeader = req.headers.get('Authorization') ?? '';
  const authClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  let callerId: string | null = null;
  if (authHeader) {
    const { data: userRes } = await authClient.auth.getUser();
    callerId = userRes?.user?.id ?? null;
  }

  // ---- weight 解決 ----
  let lookup: WeightLookup | null = null;
  let resolvedAbGroup: string;

  if (requestedAbGroup) {
    lookup = await resolveWeightsByAbGroup(admin, requestedAbGroup);
    resolvedAbGroup = requestedAbGroup;
  } else {
    // RPC 経由 (0088 が auth.uid() ベースで ab_group → profile を解決)
    lookup = await resolveWeightsFromActiveProfile(authClient, admin);
    resolvedAbGroup = await lookupCallerAbGroup(admin, callerId);
  }

  // 最終 fallback: default profile を直接読む
  if (!lookup) {
    lookup = await loadDefaultWeights(admin);
  }
  if (!lookup || lookup.weights.size === 0) {
    return jsonResponse(req, { error: 'no-active-profile' }, 500);
  }

  // ---- blending ----
  let results: RankedResult[];
  try {
    results = blend(postIds, signals, lookup.weights);
  } catch {
    return jsonResponse(req, { error: 'blend-failed' }, 500);
  }

  return jsonResponse(req, {
    results,
    ab_group: resolvedAbGroup,
    profile_name: lookup.profileName,
  });
});
