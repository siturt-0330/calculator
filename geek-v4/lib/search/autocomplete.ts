// ============================================================
// autocomplete.ts — 検索画面の suggestion data source (fallback)
// ------------------------------------------------------------
// 役割:
//   - 検索 input の suggestion 一覧を生成する単一エントリポイント
//   - 過去検索 (history) と人気タグ (popular) をマージし、prefix で絞り込む
//
// この file は UI レイヤから「呼ぶだけ」で完結する fallback 実装。
// 本実装 (search agent 側で trie / co-occur 由来の動的 suggestion を組む) が
// 来たら、同じ signature の `getAutocompleteSuggestions()` を維持しつつ中身を
// 差し替えれば良い。
//
// 2026-05 拡張 (Google 風):
//   - クエリ実行のたびに recordQuery() で永続的な統計を更新
//   - suggestQueries() が「頻度 × 直近性」でランク付けして候補を返す
//   - typo 候補 (1〜2 文字違い) を fallback として混ぜる
//   - これらは既存 getAutocompleteSuggestions / getColdStartSuggestions と
//     **並列に共存** する (既存 API は無変更, signature 維持)。
// ============================================================
import type { ParsedQuery } from './queryParser';
import { getJson, setJson } from '../storage';
import { deepNormalize, normalize } from './tokenize';
import { generateVariants } from './variants';
import { findTypoCandidates } from './typoTolerance';

export type SuggestionKind = 'history' | 'popular' | 'tag';

export type AutocompleteItem = {
  /** 表示するテキスト (タグ名 / 履歴文字列) */
  text: string;
  /** kind. UI が icon / 色分けに使う */
  kind: SuggestionKind;
  /** 補助テキスト (件数など). 無ければ undefined */
  detail?: string;
};

export interface AutocompleteContext {
  /** ユーザーの検索履歴 (新しい順) */
  history: readonly string[];
  /** 人気タグ (member_count desc 順想定) */
  popularTags: readonly { name: string; count?: number }[];
  /** 既に表示している autocomplete tag 候補 (V3 engine 由来) - dedupe 用 */
  existingTagSuggestions?: readonly string[];
}

/** 現在の query (prefix) から suggestion list を返す純関数. */
export function getAutocompleteSuggestions(
  query: string,
  ctx: AutocompleteContext,
  limit = 6,
): AutocompleteItem[] {
  const trimmed = query.trim();
  // 空クエリ時は何も返さない (上位 UI で「履歴 / 人気タグ」セクションを別に出す)
  if (trimmed.length === 0) return [];

  const lower = trimmed.toLowerCase();
  const seen = new Set<string>();
  // V3 が既に出している tag 候補は除外 (重複表示を避ける)
  for (const t of ctx.existingTagSuggestions ?? []) {
    seen.add(t.toLowerCase());
  }

  const out: AutocompleteItem[] = [];

  // 1) 履歴 — prefix match を優先 (それ以外 contains で)
  const histPrefix: AutocompleteItem[] = [];
  const histContains: AutocompleteItem[] = [];
  for (const h of ctx.history) {
    const hLower = h.toLowerCase();
    if (hLower === lower) continue; // 完全一致は self-suggest にならないように
    if (seen.has(hLower)) continue;
    if (hLower.startsWith(lower)) {
      histPrefix.push({ text: h, kind: 'history' });
      seen.add(hLower);
    } else if (hLower.includes(lower)) {
      histContains.push({ text: h, kind: 'history' });
      seen.add(hLower);
    }
  }
  out.push(...histPrefix, ...histContains);

  // 2) 人気タグ — prefix match を優先
  const popPrefix: AutocompleteItem[] = [];
  const popContains: AutocompleteItem[] = [];
  for (const t of ctx.popularTags) {
    const nLower = t.name.toLowerCase();
    if (seen.has(nLower)) continue;
    const detail = t.count !== undefined ? `${t.count.toLocaleString('ja-JP')}件` : undefined;
    if (nLower.startsWith(lower)) {
      popPrefix.push({ text: t.name, kind: 'popular', detail });
      seen.add(nLower);
    } else if (nLower.includes(lower)) {
      popContains.push({ text: t.name, kind: 'popular', detail });
      seen.add(nLower);
    }
  }
  out.push(...popPrefix, ...popContains);

  return out.slice(0, limit);
}

/** 空クエリ時の「最初の体験」用 — 履歴と人気タグを混ぜた cold-start suggestion. */
export function getColdStartSuggestions(
  ctx: AutocompleteContext,
  limit = 8,
): AutocompleteItem[] {
  const seen = new Set<string>();
  const out: AutocompleteItem[] = [];
  // 履歴を先に (個人化されたものを優先)
  for (const h of ctx.history.slice(0, Math.ceil(limit / 2))) {
    const key = h.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text: h, kind: 'history' });
  }
  // 残りを人気タグで埋める
  for (const t of ctx.popularTags) {
    if (out.length >= limit) break;
    const key = t.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const detail = t.count !== undefined ? `${t.count.toLocaleString('ja-JP')}件` : undefined;
    out.push({ text: t.name, kind: 'popular', detail });
  }
  return out.slice(0, limit);
}

/**
 * 「カテゴリ別の表示順」を返すヘルパ — Google 風に「履歴」「人気」のセクションを
 * 分けて表示したい時に使える. parsed query の hint (kind='tag' なら tag 優先) も
 * 受けて並べ替える.
 */
export function groupSuggestionsByKind(
  items: readonly AutocompleteItem[],
  _parsed?: ParsedQuery,
): { history: AutocompleteItem[]; popular: AutocompleteItem[]; tag: AutocompleteItem[] } {
  const history: AutocompleteItem[] = [];
  const popular: AutocompleteItem[] = [];
  const tag: AutocompleteItem[] = [];
  for (const it of items) {
    if (it.kind === 'history') history.push(it);
    else if (it.kind === 'popular') popular.push(it);
    else tag.push(it);
  }
  return { history, popular, tag };
}

// ============================================================
// V2 (Google 風): 永続化されたクエリ統計 + ランキング付き候補生成
// ============================================================
// 既存 getAutocompleteSuggestions / groupSuggestionsByKind とは別に、
// ・「過去検索のクエリ頻度 + lastUsed」を MMKV/localStorage に永続化
// ・suggestQueries() で「頻度 × 直近性 × prefix 一致 × typo 補正」のスコアで返す
// を提供する。既存 API は無編集で残す (signature 維持)。
// ============================================================

/**
 * 1 クエリ分の使用統計。
 *   - count: 何回検索されたか
 *   - lastUsed: 最後に検索された時刻 (ms epoch)
 *   - display: 元表記 (Google 風: dedup は正規化 key、表示は元入力)
 */
export type QueryStat = { count: number; lastUsed: number; display?: string };
export type QueryStatMap = Record<string, QueryStat>;

const QUERY_STATS_KEY = 'geek.search.autocomplete.v1';
const MAX_STORED_QUERIES = 200;
const MAX_QUERY_LEN_FOR_STATS = 80;

/** ストアからクエリ統計を読む。何も無ければ {}。 */
export function loadQueryStats(): QueryStatMap {
  return getJson<QueryStatMap>(QUERY_STATS_KEY) ?? {};
}

/** ストアにクエリ統計を書く。 */
export function saveQueryStats(stats: QueryStatMap): void {
  setJson(QUERY_STATS_KEY, stats);
}

/**
 * 1 回検索したと記録 (count++/lastUsed 更新)。
 * 200 エントリ超になると lastUsed 古い物から削る。
 * 戻り値: 更新後の統計 map (test しやすいよう返す)。
 */
export function recordQuery(raw: string, now = Date.now()): QueryStatMap {
  const q = raw.trim();
  if (!q || q.length > MAX_QUERY_LEN_FOR_STATS) return loadQueryStats();
  const stats = loadQueryStats();
  const key = deepNormalize(q) || q;
  const existing = stats[key];
  if (existing) {
    stats[key] = {
      count: existing.count + 1,
      lastUsed: now,
      display: existing.display ?? q,
    };
  } else {
    stats[key] = { count: 1, lastUsed: now, display: q };
    const entries = Object.entries(stats);
    if (entries.length > MAX_STORED_QUERIES) {
      entries.sort((a, b) => a[1].lastUsed - b[1].lastUsed);
      const toDrop = entries.slice(0, entries.length - MAX_STORED_QUERIES);
      for (const [k] of toDrop) delete stats[k];
    }
  }
  saveQueryStats(stats);
  return stats;
}

/** 統計を全消去。「履歴の削除」設定用。 */
export function clearQueryStats(): void {
  setJson(QUERY_STATS_KEY, {});
}

/**
 * 旧 searchHistoryStore の履歴 (string[]) から、まだ stats に無いものを
 * 取り込む一回限りの移行 helper。lossless。
 */
export function mergeFromHistoryList(history: readonly string[], now = Date.now()): QueryStatMap {
  const stats = loadQueryStats();
  let changed = false;
  for (let i = 0; i < history.length; i++) {
    const q = (history[i] ?? '').trim();
    if (!q || q.length > MAX_QUERY_LEN_FOR_STATS) continue;
    const key = deepNormalize(q) || q;
    if (stats[key]) continue;
    stats[key] = { count: 1, lastUsed: now - i * 1000, display: q };
    changed = true;
  }
  if (changed) saveQueryStats(stats);
  return stats;
}

/**
 * Google 風サジェスト。
 *   - source: history (過去クエリ) / tag (人気タグ) / typo (タイポ補正候補)
 *   - score: 高いほど上位
 */
export type SuggestionV2 = {
  text: string;
  source: 'history' | 'tag' | 'typo';
  score: number;
};

export type SuggestQueriesCtx = {
  /** 上書き用統計 (テスト / SSR で渡す)。省略時は loadQueryStats() */
  stats?: QueryStatMap;
  /** 候補プール (人気タグ + 既知タグ) */
  popularTags?: readonly string[];
  /** タグ → 人気度 (例: member_count) */
  tagPopularity?: Record<string, number>;
};

/**
 * 候補ランキング:
 *   - prefix 一致 +50 (タグは +40)
 *   - substring 一致 +20 (タグは +15)
 *   - 履歴の count log で加点 (頻度)
 *   - 履歴の lastUsed が直近なら +5 / +2 (recency)
 *   - タグ人気度の log で微加点
 *   - 候補が < 3 件しかない時、typo 1〜2 文字違いの popularTags を fallback
 *
 * 空クエリ → 最近検索 (lastUsed 降順) を返す。
 */
export function suggestQueries(raw: string, ctx: SuggestQueriesCtx, limit = 8): SuggestionV2[] {
  const q = raw.trim();
  const stats = ctx.stats ?? loadQueryStats();
  const popularTags = ctx.popularTags ?? [];
  const tagPop = ctx.tagPopularity ?? {};

  if (q.length === 0) {
    return Object.entries(stats)
      .sort((a, b) => b[1].lastUsed - a[1].lastUsed)
      .slice(0, limit)
      .map(([key, st]): SuggestionV2 => ({
        text: st.display ?? key,
        source: 'history',
        score: 100 + Math.log(1 + st.count),
      }));
  }

  const nq = normalize(q);
  if (!nq) return [];
  const out = new Map<string, SuggestionV2>();
  const upsert = (text: string, source: SuggestionV2['source'], score: number) => {
    const key = normalize(text) || text;
    const prev = out.get(key);
    if (!prev || score > prev.score) out.set(key, { text, source, score });
  };

  // (1) 履歴 — 比較は正規化 key + display も同時 check (元表記でも prefix 一致を拾う)
  for (const [historyKey, st] of Object.entries(stats)) {
    const h = normalize(historyKey);
    const disp = st.display ?? historyKey;
    const dn = normalize(disp);
    if (!h && !dn) continue;
    if (h === nq || dn === nq) continue;
    // prefix 一致は h と dn 両方で試す (storage 内の正規化と元表記の食い違いを吸収)
    let base = 0;
    if (h.startsWith(nq) || dn.startsWith(nq)) base = 50;
    else if (h.includes(nq) || dn.includes(nq)) base = 20;
    else continue;
    const freqBoost = Math.log(1 + st.count) * 3;
    const ageDays = (Date.now() - st.lastUsed) / 86400000;
    const recencyBoost = ageDays < 1 ? 5 : ageDays < 7 ? 2 : 0;
    upsert(disp, 'history', base + freqBoost + recencyBoost);
  }

  // (2) 人気タグ
  for (const tag of popularTags) {
    const n = normalize(tag);
    if (!n || n === nq) continue;
    let base = 0;
    if (n.startsWith(nq)) base = 40;
    else if (n.includes(nq)) base = 15;
    else continue;
    const popBoost = Math.log(1 + (tagPop[tag] ?? 0)) * 0.5;
    upsert(tag, 'tag', base + popBoost);
  }

  // (3) variants (例: "pokemon" → ポケモン候補)
  if (q.length >= 2 && q.length <= 16) {
    const variants = generateVariants(q);
    for (const v of variants) {
      const vn = normalize(v);
      if (!vn || vn === nq) continue;
      for (const tag of popularTags) {
        const tn = normalize(tag);
        if (!tn) continue;
        if (tn === vn || tn.startsWith(vn)) {
          upsert(tag, 'tag', 30 + Math.log(1 + (tagPop[tag] ?? 0)) * 0.5);
        }
      }
    }
  }

  // (4) candidates が少なすぎる時のみ typo 補正で fallback
  if (out.size < 3 && popularTags.length > 0) {
    const typoHits = findTypoCandidates(q, popularTags, { minSimilarity: 0.6, limit: 5 });
    for (const m of typoHits) {
      const key = normalize(m.candidate);
      if (!key || key === nq || out.has(key)) continue;
      upsert(m.candidate, 'typo', 10 + m.similarity * 20);
    }
  }

  return [...out.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
