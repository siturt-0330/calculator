// ============================================================
// Tag Search Engine V3 — "Beyond Google" for Hobby SNS
// ============================================================
//
// 3-stage retrieval pipeline (Google と同じ構造):
//
//   Stage 1: Recall (N-gram inverted index)
//     - O(query length) で「形が似てる候補プール」を生成
//     - 全タグ走査を廃止 → 数百タグ規模でも数msで完了
//
//   Stage 2: Rough scoring (cheap signals)
//     - N-gram 重複率 + 長さ類似度 で 上位 100 件に絞る
//     - 高コストな計算 (PMI, graph distance) を回避
//
//   Stage 3: Fine scoring (high-quality signals)
//     - 8シグナル統合 (V2 と同じ)
//     - PMI cosine 意味類似度 ← New
//     - 適応的ウェイト (クエリ長で重み変更) ← New
//     - 複合語分割 (Japanese has no spaces) ← New
//     - トレンドブースト (急上昇タグ優遇) ← New
//
// + 機能拡張:
//   - 結果ハイライト (どの部分がマッチしたか)
//   - 予測補完 (typeahead ghost text)
//   - "もしかして" タイポ補正
//
// ============================================================

import type { TagNode } from '@/stores/tagGraphStore';
import { NgramIndex, type Candidate } from './ngramIndex';
import { trySplit2Way } from './compoundSplit';
import { type EmbeddingVector, cosineSim } from './embeddings';
import { generateVariants } from './variants';
import { normalize } from './tokenize';
import { tagSimilarity } from './tagVector';
import { similarity as damerauSimilarity } from './typoCorrect';
import { highlightTag, type Segment } from './highlight';

export type SearchV3Context = {
  ngramIndex: NgramIndex;
  embeddings: Map<string, EmbeddingVector>;
  nodes: Record<string, TagNode>;
  cooccur: Record<string, Record<string, number>>;
  tagPopularity: Record<string, number>;
  likedTags?: string[];
  blockedTags?: string[];
  tagAffinity?: Record<string, number>;
  trendingTags?: Set<string>;
  // Click-through learning ボーナス: query → tag → count
  clickBoosts?: Record<string, number>;  // tag → boost score
};

export type V3Result = {
  tag: string;
  score: number;
  primaryReason: string;
  reasons: string[];
  segments: Segment[];  // ハイライト用
  signals: Record<string, number>;
};

// ============================================================
// アダプティブ ウェイト プロファイル
// ============================================================
function weights(query: string): {
  exact: number; variant: number; prefix: number; substring: number;
  fuzzy: number; vector: number; semantic: number; ngram: number;
  popularity: number; affinity: number; graph: number; trending: number;
} {
  const len = normalize(query).length;
  if (len <= 2) {
    // 短いクエリ: prefix と頻度重視
    return {
      exact: 1.0, variant: 1.0, prefix: 1.5, substring: 0.8,
      fuzzy: 0.4, vector: 0.3, semantic: 0.2, ngram: 1.2,
      popularity: 1.5, affinity: 0.8, graph: 0.5, trending: 1.5,
    };
  } else if (len <= 5) {
    return {
      exact: 1.0, variant: 1.0, prefix: 1.0, substring: 1.0,
      fuzzy: 1.0, vector: 1.0, semantic: 1.0, ngram: 1.0,
      popularity: 1.0, affinity: 1.0, graph: 1.0, trending: 1.0,
    };
  } else {
    // 長いクエリ: 意味的類似度重視
    return {
      exact: 1.0, variant: 1.0, prefix: 0.7, substring: 1.0,
      fuzzy: 1.2, vector: 1.5, semantic: 1.8, ngram: 0.8,
      popularity: 0.7, affinity: 1.2, graph: 1.2, trending: 0.8,
    };
  }
}

// ============================================================
// Stage 1+2: Recall + Rough Scoring
// ============================================================
function recallAndRough(
  query: string,
  ctx: SearchV3Context,
  limit: number,
): Candidate[] {
  // N-gram 逆引きで候補を取得
  const candidates = ctx.ngramIndex.query(query, 1);
  // n-gram 重複率と長さ類似度の合成スコアでソート
  const qLen = normalize(query).length;
  const scored = candidates.map((c) => {
    const tLen = normalize(c.tag).length;
    const lenSim = 1 - Math.abs(qLen - tLen) / Math.max(qLen, tLen);
    return {
      ...c,
      roughScore: c.matchedNgrams * 10 + lenSim * 5,
    };
  });
  scored.sort((a, b) => b.roughScore - a.roughScore);
  return scored.slice(0, limit);
}

// ============================================================
// Stage 3: Fine Scoring (per single token)
// ============================================================
function fineScoreOne(
  candidate: string,
  token: string,
  variants: string[],
  variantSet: Set<string>,
  ctx: SearchV3Context,
  w: ReturnType<typeof weights>,
): { score: number; reason: string; signals: Record<string, number> } {
  const tn = normalize(candidate);
  const qn = normalize(token);
  const signals: Record<string, number> = {};

  if (tn === qn) {
    signals.exact = 1000 * w.exact;
    return { score: signals.exact, reason: '完全一致', signals };
  }
  if (variantSet.has(tn)) {
    signals.variant = 800 * w.variant;
    return { score: signals.variant, reason: '同義語', signals };
  }
  // Acronym (英字クエリ かつ tag が複合語)
  if (/^[a-z]{2,5}$/i.test(qn)) {
    const acr = candidate.split(/\s+|・|の|＝|=/).map((s) => s.charAt(0)).join('').toLowerCase();
    if (acr === qn) {
      signals.acronym = 700;
      return { score: signals.acronym, reason: '頭字語', signals };
    }
  }
  if (tn.startsWith(qn)) {
    signals.prefix = Math.max(450, 600 - tn.length * 2) * w.prefix;
    return { score: signals.prefix, reason: '前方一致', signals };
  }
  if (tn.includes(qn)) {
    signals.substring = Math.max(280, 350 - tn.length * 2) * w.substring;
    return { score: signals.substring, reason: '部分一致', signals };
  }
  for (const v of variants) {
    const vn = normalize(v);
    if (vn.length >= 2 && tn.includes(vn)) {
      signals.variantSub = 230 * w.variant;
      return { score: signals.variantSub, reason: '表記ゆれ', signals };
    }
  }
  const sim = damerauSimilarity(qn, tn);
  if (sim >= 0.55 && qn.length >= 2) {
    signals.fuzzy = Math.round(100 + (sim - 0.55) * 400) * w.fuzzy;
    return { score: signals.fuzzy, reason: 'タイポ補正', signals };
  }
  const vec = tagSimilarity(token, candidate, { nodes: ctx.nodes, cooccur: ctx.cooccur });
  if (vec.score >= 0.3) {
    signals.vector = Math.round(50 + vec.score * 200) * w.vector;
    return { score: signals.vector, reason: vec.signals[0] ?? '関連', signals };
  }
  return { score: 0, reason: '', signals };
}

// ============================================================
// Graph distance (V2 と同じロジックを再利用)
// ============================================================
function graphDistance(from: string, to: string, nodes: Record<string, TagNode>): number {
  if (from === to) return 0;
  const labelToId: Record<string, string> = {};
  for (const [id, n] of Object.entries(nodes)) {
    labelToId[n.label] = id;
    for (const a of n.aliases) labelToId[a] = id;
  }
  const startId = labelToId[from];
  const goalId = labelToId[to];
  if (!startId || !goalId) return Infinity;
  const visited = new Set<string>([startId]);
  let frontier = [startId];
  for (let depth = 1; depth <= 3; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      const n = nodes[id];
      if (!n) continue;
      const neighbors: string[] = [...n.children];
      for (const r of n.related ?? []) {
        const rid = labelToId[r];
        if (rid) neighbors.push(rid);
      }
      for (const nb of neighbors) {
        if (visited.has(nb)) continue;
        if (nb === goalId) return depth;
        visited.add(nb);
        next.push(nb);
      }
    }
    frontier = next;
  }
  return Infinity;
}

// ============================================================
// MAIN: searchTagsV3
// ============================================================
export function searchTagsV3(
  query: string,
  ctx: SearchV3Context,
  opts: { limit?: number; diversify?: boolean; recallSize?: number } = {},
): V3Result[] {
  const limit = opts.limit ?? 12;
  const diversify = opts.diversify ?? true;
  const recallSize = opts.recallSize ?? 200;

  const trimmed = query.trim().replace(/^#/, '');
  if (trimmed.length < 1) return [];

  // クエリトークン化 (空白あり + 複合語分割を試す)
  const wsTokens = trimmed.split(/\s+|　/).filter((t) => t.length > 0);
  let allTokens: string[] = wsTokens;
  // 複合語分割: 単一トークンの場合のみ
  if (wsTokens.length === 1) {
    const knownTagSet = new Set([...Object.keys(ctx.tagPopularity), ...ctx.ngramIndex.getAllTags()]);
    const split = trySplit2Way(wsTokens[0]!, knownTagSet);
    if (split && split.length >= 2 && split.every((p) => p.length >= 2)) {
      // 元のトークンを残しつつ、分割結果も検索対象に
      allTokens = [...wsTokens, ...split];
    }
  }

  const w = weights(trimmed);
  const blockedSet = new Set((ctx.blockedTags ?? []).map(normalize));
  const likedSet = new Set((ctx.likedTags ?? []).map(normalize));

  // 各トークンの variants
  const variantsByToken = allTokens.map((t) => {
    const v = generateVariants(t);
    return { token: t, variants: v, variantSet: new Set(v.map(normalize)) };
  });

  // Stage 1+2: Recall via N-gram + rough rank
  const candidatePool = new Set<string>();
  for (const { token } of variantsByToken) {
    const cands = recallAndRough(token, ctx, recallSize);
    for (const c of cands) candidatePool.add(c.tag);
  }
  // Graph タグも候補に追加
  for (const n of Object.values(ctx.nodes)) {
    candidatePool.add(n.label);
    for (const a of n.aliases) candidatePool.add(a);
    for (const r of n.related ?? []) candidatePool.add(r);
  }

  // Stage 3: Fine scoring
  const scored: V3Result[] = [];
  const seenN = new Set<string>();
  // PMI Embeddings (クエリ単独 tag に対する近傍を計算)
  const queryEmbedding = ctx.embeddings.get(allTokens[0] ?? '');

  for (const candidate of candidatePool) {
    const tn = normalize(candidate);
    if (blockedSet.has(tn) || seenN.has(tn)) continue;
    seenN.add(tn);

    // 各トークンの fine score を計算 (元クエリのトークンを優先)
    const perToken = variantsByToken.slice(0, wsTokens.length).map(({ token, variants, variantSet }) =>
      fineScoreOne(candidate, token, variants, variantSet, ctx, w),
    );
    // 複合語分割トークンは "あればうれしい" 程度の弱いスコア
    const perSplit = variantsByToken.slice(wsTokens.length).map(({ token, variants, variantSet }) =>
      fineScoreOne(candidate, token, variants, variantSet, ctx, w),
    );

    const tokenHits = perToken.filter((p) => p.score > 0);
    const splitHits = perSplit.filter((p) => p.score > 0);
    // 必須: 少なくとも1つの主トークンがヒット OR 分割の両方がヒット
    if (tokenHits.length === 0 && splitHits.length < 2) continue;

    let score = 0;
    const reasons: string[] = [];
    const signalsAgg: Record<string, number> = {};
    for (const r of [...tokenHits, ...splitHits]) {
      score += r.score;
      reasons.push(r.reason);
      for (const [k, v] of Object.entries(r.signals)) signalsAgg[k] = (signalsAgg[k] ?? 0) + v;
    }
    const isMulti = wsTokens.length > 1;
    score = score / Math.max(1, wsTokens.length);
    if (isMulti && tokenHits.length === wsTokens.length) {
      score += 100;
      reasons.push('全マッチ');
    }
    if (splitHits.length >= 2) {
      score += 80;
      reasons.push('複合語マッチ');
    }

    // === 追加ブースト ===
    // PMI 意味類似度 (queryEmbedding が存在する場合)
    if (queryEmbedding) {
      const candEmb = ctx.embeddings.get(candidate);
      if (candEmb) {
        const semSim = cosineSim(queryEmbedding, candEmb);
        if (semSim >= 0.15) {
          const semSig = semSim * 200 * w.semantic;
          score += semSig;
          signalsAgg.semantic = semSig;
          if (semSim >= 0.4) reasons.push('意味的関連');
        }
      }
    }

    // 人気度
    const pop = ctx.tagPopularity[candidate] ?? 0;
    if (pop > 0) {
      const popSig = Math.log(1 + pop) * 3 * w.popularity;
      score += popSig;
      signalsAgg.popularity = popSig;
    }

    // ユーザー親和度
    const aff = (ctx.tagAffinity ?? {})[candidate] ?? 0;
    if (aff > 0) {
      const affSig = Math.log(1 + aff) * 5 * w.affinity;
      score += affSig;
      signalsAgg.affinity = affSig;
    }

    // liked タグからのグラフ距離
    if (likedSet.size > 0) {
      let minDist = Infinity;
      for (const lt of (ctx.likedTags ?? [])) {
        const d = graphDistance(lt, candidate, ctx.nodes);
        if (d < minDist) minDist = d;
      }
      if (minDist !== Infinity) {
        const graphSig = (minDist === 1 ? 40 : minDist === 2 ? 20 : 10) * w.graph;
        score += graphSig;
        signalsAgg.graph = graphSig;
      }
    }

    // 共起活動量
    const coo = ctx.cooccur[candidate];
    if (coo) {
      const cooTotal = Object.values(coo).reduce((a, b) => a + b, 0);
      score += Math.log(1 + cooTotal) * 1.5;
    }

    // トレンドブースト
    if (ctx.trendingTags?.has(candidate)) {
      const trSig = 60 * w.trending;
      score += trSig;
      signalsAgg.trending = trSig;
      reasons.push('🔥トレンド');
    }

    // Click-Through Learning ボーナス: 過去にこのクエリで選ばれたタグを優遇
    if (ctx.clickBoosts && ctx.clickBoosts[candidate]) {
      const ctrSig = Math.min(150, ctx.clickBoosts[candidate]! * 20);
      score += ctrSig;
      signalsAgg.ctr = ctrSig;
      reasons.push('🎯前回選択');
    }

    if (score > 0) {
      const segments = highlightTag(candidate, allTokens.flatMap((t) => generateVariants(t)));
      scored.push({
        tag: candidate,
        score,
        primaryReason: reasons[0] ?? '関連',
        reasons: Array.from(new Set(reasons)),
        segments,
        signals: signalsAgg,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  // ダイバーシフィケーション
  if (!diversify) return scored.slice(0, limit);
  const picked: V3Result[] = [];
  for (const s of scored) {
    if (picked.length >= limit) break;
    const tooSimilar = picked.some((p) =>
      damerauSimilarity(normalize(p.tag), normalize(s.tag)) >= 0.85,
    );
    if (tooSimilar) continue;
    picked.push(s);
  }
  return picked;
}

// ============================================================
// 予測補完 (typeahead ghost text)
// "アニ" → "アニメ" を予測して返す。 prefix 一致で最も人気なタグ。
// ============================================================
export function predictCompletion(
  query: string,
  ctx: SearchV3Context,
): string | null {
  const qn = normalize(query.trim());
  if (qn.length < 1) return null;
  const candidates = ctx.ngramIndex.query(qn, 1);
  let best: { tag: string; pop: number } | null = null;
  for (const { tag } of candidates) {
    const tn = normalize(tag);
    if (tn === qn) continue;  // 完全一致は予測する必要なし
    if (!tn.startsWith(qn)) continue;
    const pop = ctx.tagPopularity[tag] ?? 0;
    if (!best || pop > best.pop) best = { tag, pop };
  }
  if (!best) return null;
  // 元のクエリ + 残りの部分を返す
  return best.tag;
}
