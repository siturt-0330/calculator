// ============================================================
// lib/api/searchV4.ts — Search v4 client API
// ------------------------------------------------------------
// Search v4 のサーバ側機構を呼ぶ client 層。
//
//   - search_posts_v4 RPC (migration 0097)
//       多 signal ランキング (text_relevance / recency / eeat / usability /
//       viewed_boost / history_boost / safety_negation / clickbait_negation /
//       freshness / diversity_penalty) を server 側で合算。
//
//   - classify_query_intent RPC (migration 0094)
//       検索クエリの意図分類 (information / navigation / transaction 等)。
//
//   - get_active_ranking_weights / get_weights_for_query RPC (0094)
//       現在 active な ranking signal weight を取得。
//       クエリ依存の重み調整 (intent classifier 経由) は get_weights_for_query。
//
//   - log_search_engagement RPC (0095)
//       インプレッション / クリック / dwell 等のエンゲージメントを記録
//       (fire-and-forget — 失敗してもユーザー体験を止めない)。
//
//   - search-explainer Edge function (Supabase Functions)
//       "なぜこの結果が出たか" の人間向け説明テキスト + factor 分解。
//       RPC では返しづらい翻訳 / 整形を server side で行うため Edge 経由。
//
// 既存 lib/api/search.ts (Search v2) と並列。v4 は signal 数と explainability が
// 大きいので別 file に分離。component は hooks/useSearchV4.* 経由で利用想定。
//
// 設計方針:
//   - 失敗時は基本「空配列 or 中立値」を返してアプリを止めない (search は best-effort)
//   - timeout は withApiTimeout で固定 (UI 応答性最優先)
//   - response shape は server から unknown で受けて type guard で validate
//     (column rename / nullable 化に強くする)
// ============================================================

import { supabase } from '../supabase';
import { withApiTimeout } from '../withApiTimeout';
import { swallow } from '../swallow';

// ----------------------------------------------------------------
// 型定義
// ----------------------------------------------------------------

/**
 * ランキング signal の識別子。
 * 0094/0095/0097 で server 側 weight table に登録されているキーと一致させる。
 *
 * positive signals: text_relevance / recency / eeat / usability /
 *                   viewed_boost / history_boost / freshness
 * negative signals: safety_negation / clickbait_negation / diversity_penalty
 */
export type RankingSignal =
  | 'text_relevance'
  | 'recency'
  | 'eeat'
  | 'usability'
  | 'viewed_boost'
  | 'history_boost'
  | 'safety_negation'
  | 'clickbait_negation'
  | 'freshness'
  | 'diversity_penalty';

/**
 * search_posts_v4 RPC の 1 投稿分のレスポンス。
 * - final_score: 最終ランキング値 (降順表示)
 * - contributions: 各 signal の寄与 (key は RankingSignal の部分集合)
 * - intent: 推定クエリ意図 ('general' fallback あり)
 * - diversity_factor: 多様化適用後の補正係数 (0..1)
 * - matched_terms: ハイライト用にマッチしたトークン
 */
export type SearchV4Result = {
  post_id: string;
  final_score: number;
  contributions: Partial<Record<RankingSignal, number>>;
  intent: string;
  diversity_factor: number;
  matched_terms: string[];
};

export type SearchV4Args = {
  /** ユーザー入力クエリ (trim 前提) */
  query: string;
  /** 1 ページあたり件数 (既定 20) */
  limit?: number;
  /** offset-based pagination (既定 0) */
  offset?: number;
  /** community 内検索のスコープ (optional) */
  community_id?: string;
  /** diversity penalty を適用するか (既定 true 想定、UI で off 切替可) */
  use_diversify?: boolean;
  /** sign election (positive/negative weight の競合解決) を有効化するか */
  use_sign_election?: boolean;
};

/**
 * search-explainer Edge function のレスポンス。
 * factor は positive/negative/neutral に分類されているので UI で色分け可能。
 */
export type ResultExplanation = {
  factors: Array<{
    key: string;
    weight: number;
    contribution: number;
    description: string;
    category: 'positive' | 'negative' | 'neutral';
  }>;
  total_score: number;
  query_intent: string;
  is_personalized: boolean;
};

export type QueryIntent = {
  intent: string;
  /** 0..1 の確信度 */
  confidence: number;
};

export type ActiveWeights = Array<{
  signal_key: RankingSignal;
  /** softmax / sigmoid 通過後の effective lambda (UI 表示・debug 用) */
  effective_lambda: number;
  /** signal contribution の clip 閾値 */
  threshold: number;
}>;

// ----------------------------------------------------------------
// 型ガード (RPC レスポンスは unknown で受けて validate)
// ----------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asNumber(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

const RANKING_SIGNAL_KEYS: readonly RankingSignal[] = [
  'text_relevance',
  'recency',
  'eeat',
  'usability',
  'viewed_boost',
  'history_boost',
  'safety_negation',
  'clickbait_negation',
  'freshness',
  'diversity_penalty',
];

function isRankingSignal(key: string): key is RankingSignal {
  return (RANKING_SIGNAL_KEYS as readonly string[]).includes(key);
}

function asContributions(v: unknown): Partial<Record<RankingSignal, number>> {
  if (!isRecord(v)) return {};
  const out: Partial<Record<RankingSignal, number>> = {};
  for (const [key, val] of Object.entries(v)) {
    if (!isRankingSignal(key)) continue;
    if (typeof val !== 'number' || !Number.isFinite(val)) continue;
    out[key] = val;
  }
  return out;
}

function parseSearchV4Row(raw: unknown): SearchV4Result | null {
  if (!isRecord(raw)) return null;
  const post_id = asString(raw.post_id);
  if (!post_id) return null;
  return {
    post_id,
    final_score: asNumber(raw.final_score),
    contributions: asContributions(raw.contributions),
    intent: asString(raw.intent, 'general'),
    diversity_factor: asNumber(raw.diversity_factor, 1),
    matched_terms: asStringArray(raw.matched_terms),
  };
}

function parseQueryIntent(raw: unknown): QueryIntent | null {
  if (!isRecord(raw)) return null;
  const intent = asString(raw.intent);
  if (!intent) return null;
  return {
    intent,
    confidence: asNumber(raw.confidence),
  };
}

function parseActiveWeightRow(raw: unknown): ActiveWeights[number] | null {
  if (!isRecord(raw)) return null;
  const key = asString(raw.signal_key);
  if (!isRankingSignal(key)) return null;
  return {
    signal_key: key,
    effective_lambda: asNumber(raw.effective_lambda),
    threshold: asNumber(raw.threshold),
  };
}

function parseExplanation(raw: unknown): ResultExplanation {
  const fallback: ResultExplanation = {
    factors: [],
    total_score: 0,
    query_intent: 'general',
    is_personalized: false,
  };
  if (!isRecord(raw)) return fallback;

  const factorsRaw = Array.isArray(raw.factors) ? raw.factors : [];
  const factors: ResultExplanation['factors'] = [];
  for (const f of factorsRaw) {
    if (!isRecord(f)) continue;
    const key = asString(f.key);
    if (!key) continue;
    const categoryRaw = asString(f.category, 'neutral');
    const category: ResultExplanation['factors'][number]['category'] =
      categoryRaw === 'positive' || categoryRaw === 'negative' ? categoryRaw : 'neutral';
    factors.push({
      key,
      weight: asNumber(f.weight),
      contribution: asNumber(f.contribution),
      description: asString(f.description),
      category,
    });
  }

  return {
    factors,
    total_score: asNumber(raw.total_score),
    query_intent: asString(raw.query_intent, 'general'),
    is_personalized: typeof raw.is_personalized === 'boolean' ? raw.is_personalized : false,
  };
}

// ----------------------------------------------------------------
// search_posts_v4 (0097)
// ----------------------------------------------------------------

/**
 * token sanitize:
 * supabase の `or()` クエリビルダに渡す ilike pattern は
 * `,` `)` `(` で構文が壊れる (filter 列挙の区切り)。`%` は ilike の
 * wildcard なので token 中に残っていると意図しないマッチを生む。
 * 加えて URL encoding を入れる前段で危険文字を全て落とす。
 *
 * 許容文字:
 *   - 英数字 (alphabet / digit)
 *   - 日本語 (ひらがな / カタカナ / 漢字 / 全角/半角カナ)
 *   - 空白以外の sane 記号は許容しない (壊れる方が痛い)
 *
 * 結果が空文字なら null を返して呼び出し側で skip させる。
 */
function sanitizeSearchToken(raw: string): string | null {
  // Allow ASCII alnum + JP scripts (hiragana / katakana / CJK)
  // Drop: %, ,, ), (, *, ", ', \\, /, =, ;, :, [, ], {, }, <, >, |, &, control chars
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9぀-ゟ゠-ヿ㐀-䶿一-鿿ｦ-ﾟ]/g, '');
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * fallback ilike 検索:
 * 0085-0097 の migration が本番 Supabase に未適用な状況でも検索 UI を動かす
 * ためのクライアント側 fallback。posts table に対して直接 ilike OR 検索を
 * 走らせ、SearchV4Result shape に揃えて返す。
 *
 * 制約:
 *   - title もしくは content への部分一致のみ (BM25 / FTS は使わない)
 *   - ranking は created_at desc の simple な逆数スコア
 *   - community_id 指定時は post_communities でその community の post に絞る
 *     (RLS により viewer が見られるコミュ投稿のみ返る = UI の「このコミュニティ内」
 *      chip と結果が一致する。旧実装は scope を無視して全体検索を返す silent degrade だった)
 *   - 結果は最大 (offset + limit) 件まで取って残りは捨てる
 */
async function fallbackIlikeSearch(
  query: string,
  limit: number,
  offset: number,
  communityId?: string,
): Promise<SearchV4Result[]> {
  const tokens = query
    .trim()
    .split(/\s+/)
    .map((t) => sanitizeSearchToken(t))
    .filter((t): t is string => t !== null && t.length > 0);

  if (tokens.length === 0) return [];

  // OR clause: title.ilike.%t1%,content.ilike.%t1%,title.ilike.%t2%,...
  const orClauses = tokens
    .flatMap((t) => [`title.ilike.%${t}%`, `content.ilike.%${t}%`])
    .join(',');

  try {
    // community scope 指定時は post_communities でその community の post_id に絞る。
    // post_communities は RLS 対象なので viewer が見られるコミュ投稿のみ返る。
    // (巨大コミュで .in() の URL が長くなり 414 になった場合も error→[] で
    //  graceful に空を返す = 他コミュの結果を漏らさない)
    let allowedIds: string[] | null = null;
    if (communityId) {
      const { data: pc, error: pcErr } = await withApiTimeout(
        supabase.from('post_communities').select('post_id').eq('community_id', communityId),
        'searchV4.fallbackCommunityIds',
        8000,
      );
      if (pcErr) {
        swallow('searchV4.fallbackCommunityIds', pcErr);
        return [];
      }
      allowedIds = (Array.isArray(pc) ? pc : [])
        .map((r) => (isRecord(r) ? asString(r.post_id) : ''))
        .filter((id) => id.length > 0);
      if (allowedIds.length === 0) return [];
    }

    let builder = supabase
      .from('posts')
      .select('id, created_at')
      .or(orClauses);
    if (allowedIds) builder = builder.in('id', allowedIds);
    builder = builder
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, error } = await withApiTimeout(
      builder,
      'searchV4.fallbackIlike',
      8000,
    );

    if (error) {
      swallow('searchV4.fallbackIlike', error);
      return [];
    }

    const rows: unknown[] = Array.isArray(data) ? data : [];
    const results: SearchV4Result[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!isRecord(row)) continue;
      const post_id = asString(row.id);
      if (!post_id) continue;
      results.push({
        post_id,
        final_score: 1 / (i + 1),
        contributions: {},
        intent: 'general',
        diversity_factor: 1,
        matched_terms: tokens,
      });
    }
    return results;
  } catch (e) {
    swallow('searchV4.fallbackIlike.timeout', e);
    return [];
  }
}

/**
 * search_posts_v4 RPC を呼んで多 signal ランキング結果を返す。
 *
 * 二段構え:
 *   1) `search_posts_v4` RPC (migration 0097) を試す
 *   2) RPC が未デプロイ (function does not exist / 404 / 401) や
 *      空配列を返した場合 → fallbackIlikeSearch で posts table 直接検索
 *
 * 空クエリ / 全失敗時は `[]` を返す (search は best-effort)。
 * timeout は 8s 固定 (UI 応答性最優先)。
 */
export async function searchPostsV4(args: SearchV4Args): Promise<SearchV4Result[]> {
  const trimmed = args.query.trim();
  if (!trimmed) return [];

  const limit = args.limit ?? 20;
  const offset = args.offset ?? 0;

  // 1) v4 RPC を試す
  try {
    const { data, error } = await withApiTimeout(
      supabase.rpc('search_posts_v4', {
        p_query: trimmed,
        p_limit: limit,
        p_offset: offset,
        p_community_id: args.community_id ?? null,
        p_use_diversify: args.use_diversify ?? true,
        p_use_sign_election: args.use_sign_election ?? true,
      }),
      'searchV4.searchPostsV4',
      8000,
    );
    if (!error && Array.isArray(data) && data.length > 0) {
      const parsed: SearchV4Result[] = [];
      for (const r of data) {
        const row = parseSearchV4Row(r);
        if (row) parsed.push(row);
      }
      if (parsed.length > 0) return parsed;
      // RPC が返したが parse 後に全部捨てられた → fallback に進む
    } else if (error) {
      // RPC 自体が失敗 (function does not exist / 401 / 404 等) → fallback
      swallow('searchV4.searchPostsV4', error);
    }
    // error が無くて data が空配列の場合も fallback に進む
  } catch (e) {
    swallow('searchV4.searchPostsV4.rpc', e);
  }

  // 2) fallback: posts 直接 ilike 検索 (community scope も尊重する)
  return await fallbackIlikeSearch(trimmed, limit, offset, args.community_id);
}

// ----------------------------------------------------------------
// search-explainer (Edge function)
// ----------------------------------------------------------------

/**
 * search-explainer Edge function を fetch で呼び出して
 * 検索結果の "なぜこの順位か" の説明を取得する。
 *
 * RPC ではなく Edge function 経由なのは:
 *   - 説明テキストの翻訳 / 整形 (markdown 化等) を server side で完結させたい
 *   - 上位モデル呼び出し等の拡張余地を残したい
 *
 * 失敗時は中立値を返す (UI は説明欄を空表示にできる)。
 */
export async function explainSearchResult(
  post_id: string,
  query: string,
  include_advanced?: boolean,
): Promise<ResultExplanation> {
  const fallback: ResultExplanation = {
    factors: [],
    total_score: 0,
    query_intent: 'general',
    is_personalized: false,
  };

  const baseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!baseUrl) {
    swallow('searchV4.explainSearchResult', new Error('EXPO_PUBLIC_SUPABASE_URL is missing'));
    return fallback;
  }

  const url = `${baseUrl}/functions/v1/search-explainer`;

  try {
    // 認証された session の access_token を Authorization header に乗せる。
    // anon でも Edge function 自体は呼べる想定だが、personalized factor
    // (history_boost 等) を返すには JWT が必要。
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          post_id,
          query,
          include_advanced: include_advanced ?? false,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      swallow(
        'searchV4.explainSearchResult.http',
        new Error(`HTTP ${res.status} ${res.statusText}`),
      );
      return fallback;
    }

    const json: unknown = await res.json();
    return parseExplanation(json);
  } catch (e) {
    swallow('searchV4.explainSearchResult.fetch', e);
    return fallback;
  }
}

// ----------------------------------------------------------------
// classify_query_intent (0094)
// ----------------------------------------------------------------

/**
 * classify_query_intent RPC を呼んでクエリ意図候補を返す。
 *
 * 失敗時は `[]`。
 */
export async function classifyQueryIntent(query: string): Promise<QueryIntent[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  try {
    const { data, error } = await withApiTimeout(
      supabase.rpc('classify_query_intent', { p_query: trimmed }),
      'searchV4.classifyQueryIntent',
      5000,
    );
    if (error) {
      swallow('searchV4.classifyQueryIntent', error);
      return [];
    }
    const rows: unknown[] = Array.isArray(data) ? data : [];
    const parsed: QueryIntent[] = [];
    for (const r of rows) {
      const item = parseQueryIntent(r);
      if (item) parsed.push(item);
    }
    return parsed;
  } catch (e) {
    swallow('searchV4.classifyQueryIntent.timeout', e);
    return [];
  }
}

// ----------------------------------------------------------------
// get_active_ranking_weights / get_weights_for_query (0094)
// ----------------------------------------------------------------

function parseActiveWeights(data: unknown): ActiveWeights {
  const rows: unknown[] = Array.isArray(data) ? data : [];
  const parsed: ActiveWeights = [];
  for (const r of rows) {
    const row = parseActiveWeightRow(r);
    if (row) parsed.push(row);
  }
  return parsed;
}

/**
 * get_active_ranking_weights RPC を呼んで現在 active な signal weight を返す。
 * admin の weight 編集 UI 等で使う想定。
 */
export async function getActiveRankingWeights(): Promise<ActiveWeights> {
  try {
    const { data, error } = await withApiTimeout(
      supabase.rpc('get_active_ranking_weights'),
      'searchV4.getActiveRankingWeights',
      5000,
    );
    if (error) {
      swallow('searchV4.getActiveRankingWeights', error);
      return [];
    }
    return parseActiveWeights(data);
  } catch (e) {
    swallow('searchV4.getActiveRankingWeights.timeout', e);
    return [];
  }
}

/**
 * get_weights_for_query RPC を呼んでクエリ依存の signal weight を返す。
 * intent classifier の結果を反映した動的 weight (例えば transaction クエリでは
 * usability / safety_negation の重みが強くなる等)。
 *
 * 失敗時は `[]` (UI 側は active weights にフォールバック可能)。
 */
export async function getWeightsForQuery(query: string): Promise<ActiveWeights> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  try {
    const { data, error } = await withApiTimeout(
      supabase.rpc('get_weights_for_query', { p_query: trimmed }),
      'searchV4.getWeightsForQuery',
      5000,
    );
    if (error) {
      swallow('searchV4.getWeightsForQuery', error);
      return [];
    }
    return parseActiveWeights(data);
  } catch (e) {
    swallow('searchV4.getWeightsForQuery.timeout', e);
    return [];
  }
}

// ----------------------------------------------------------------
// log_search_engagement (0095) — fire-and-forget
// ----------------------------------------------------------------

/**
 * 検索結果へのユーザー engagement を server に記録する。
 *
 * fire-and-forget: await はするが error は swallow し、呼び出し側に伝播させない。
 * これは log 失敗で UI 操作 (click, like 等の本来の action) を阻害したくないため。
 *
 * action の意味:
 *   - impression: 結果が画面に表示された
 *   - click: 結果カードがタップされた
 *   - dwell: 詳細画面で N ms 滞在した (dwell_ms 必須相当)
 *   - like / comment / save / share / concern: 詳細経由でのアクション
 */
export async function logSearchEngagement(args: {
  query: string;
  post_id: string;
  position: number;
  action: 'impression' | 'click' | 'dwell' | 'like' | 'comment' | 'save' | 'share' | 'concern';
  dwell_ms?: number;
  rank_signals?: unknown;
}): Promise<void> {
  try {
    const { error } = await withApiTimeout(
      supabase.rpc('log_search_engagement', {
        p_query: args.query,
        p_post_id: args.post_id,
        p_position: args.position,
        p_action: args.action,
        p_dwell_ms: args.dwell_ms ?? null,
        p_rank_signals: args.rank_signals ?? null,
      }),
      'searchV4.logSearchEngagement',
      5000,
    );
    if (error) {
      swallow('searchV4.logSearchEngagement', error);
    }
  } catch (e) {
    swallow('searchV4.logSearchEngagement.timeout', e);
  }
}
