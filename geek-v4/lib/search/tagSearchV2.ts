// ============================================================
// Tag Search Engine V2 — Google レベルのタグ検索
// ============================================================
//
// 何をやっているか:
//
// 1. クエリ解析: マルチトークン ("鬼滅 アニメ") を分解
// 2. クエリ展開: variants (ローマ字 → カナ、=LOVE → イコラブ 等)
// 3. 候補プール: tags テーブル + graph + 共起マップ から候補集合を構築
// 4. 各候補に対して 8 次元のシグナル スコアを計算:
//    a. 完全一致 (1000)
//    b. 同義語/Variant 一致 (800)
//    c. アクロニム一致 (700)  例: "FF" → "Final Fantasy"
//    d. 前方一致 (500 - tag_length)
//    e. 部分一致 (300 - tag_length)
//    f. 字面ファジー (Damerau-Levenshtein) (100-300)
//    g. ベクトル類似度 (字面+共起+graph) (0-200)
//    h. マルチトークン全ヒット ボーナス (+100)
// 5. ブースト:
//    - 人気度 (log scale)
//    - リーフ近接 (likedTags に近いタグ) — グラフ距離で判定
//    - リアクティブ性 (recent cooccur activity)
//    - liked タグからの直接の related/sibling → 強ブースト
// 6. ダイバーシフィケーション: 類似タグの cluster suppression
// 7. ノルマライズ + ソート + top N

import type { TagNode } from '../../stores/tagGraphStore';
import { generateVariants } from './variants';
import { normalize } from './tokenize';
import { tagSimilarity } from './tagVector';
import { similarity as damerauSimilarity } from './typoCorrect';

export type TagSearchContext = {
  allTags: string[];
  nodes: Record<string, TagNode>;
  cooccur: Record<string, Record<string, number>>;
  tagPopularity: Record<string, number>;
  likedTags?: string[];
  blockedTags?: string[];
  tagAffinity?: Record<string, number>;
};

export type ScoredTag = {
  tag: string;
  score: number;
  reasons: string[];
  primaryReason: string;
};

// アクロニム生成: "Final Fantasy" → "ff", "鬼滅の刃" → "き刃" など
// ASCII を含む単語に対してのみ意味のある結果。
function acronym(s: string): string {
  return s
    .split(/\s+|・|の|・/)
    .map((w) => w.charAt(0))
    .join('')
    .toLowerCase();
}

// マルチトークン分解
function tokenize(query: string): string[] {
  return query.trim().split(/\s+/).filter((t) => t.length > 0);
}

// グラフ距離: liked タグから候補タグへの最短距離 (BFS, 上限 3 hop)
function graphDistance(from: string, to: string, nodes: Record<string, TagNode>): number {
  if (from === to) return 0;
  // tag.label / aliases / related から探す
  const labelToId: Record<string, string> = {};
  for (const [id, n] of Object.entries(nodes)) {
    labelToId[n.label] = id;
    for (const a of n.aliases) labelToId[a] = id;
  }
  const startId = labelToId[from];
  const goalId = labelToId[to];
  if (!startId || !goalId) return Infinity;

  // BFS up to depth 3
  const visited = new Set<string>([startId]);
  let frontier: string[] = [startId];
  for (let depth = 1; depth <= 3; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      const n = nodes[id];
      if (!n) continue;
      const neighbors: string[] = [];
      // children
      for (const c of n.children) neighbors.push(c);
      // parent (compute)
      // related: ラベルから ID 解決
      for (const r of (n.related ?? [])) {
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

// 単一トークンに対する候補タグのスコアリング
function scoreTagForToken(
  candidate: string,
  token: string,
  variants: string[],
  variantSet: Set<string>,
  ctx: TagSearchContext,
): { score: number; reasons: string[] } {
  const tn = normalize(candidate);
  const qn = normalize(token);
  const reasons: string[] = [];
  let score = 0;

  // (a) 完全一致
  if (tn === qn) {
    score = 1000;
    reasons.push('完全一致');
    return { score, reasons };
  }
  // (b) Variant 一致
  if (variantSet.has(tn)) {
    score = 800;
    reasons.push('同義語');
    return { score, reasons };
  }
  // (c) Acronym 一致 (英字クエリ かつ tag が複合語)
  if (/^[a-z]{2,5}$/i.test(qn) && /\s|・|の/.test(candidate)) {
    const acr = acronym(candidate);
    if (acr === qn) {
      score = 700;
      reasons.push('頭字語');
      return { score, reasons };
    }
  }
  // (d) 前方一致 (短いタグほど高スコア)
  if (tn.startsWith(qn)) {
    score = Math.max(550, 600 - tn.length * 2);
    reasons.push('前方一致');
    return { score, reasons };
  }
  // (e) 部分一致
  if (tn.includes(qn)) {
    score = Math.max(300, 350 - tn.length * 2);
    reasons.push('部分一致');
    return { score, reasons };
  }
  // (f) Variant の部分一致
  for (const v of variants) {
    const vn = normalize(v);
    if (vn.length >= 2 && tn.includes(vn)) {
      score = 250;
      reasons.push('表記ゆれ');
      return { score, reasons };
    }
  }
  // (g) ファジー (Damerau-Levenshtein 類似度)
  const sim = damerauSimilarity(qn, tn);
  if (sim >= 0.55 && qn.length >= 2) {
    score = Math.round(100 + (sim - 0.55) * 400);  // 0.55 → 100, 1.0 → 280
    reasons.push('タイポ補正');
    return { score, reasons };
  }
  // (h) ベクトル類似度 (字面 n-gram + 共起 + graph)
  const vec = tagSimilarity(token, candidate, {
    nodes: ctx.nodes,
    cooccur: ctx.cooccur,
  });
  if (vec.score >= 0.3) {
    score = Math.round(50 + vec.score * 200);
    reasons.push(vec.signals[0] ?? '関連');
    return { score, reasons };
  }
  return { score: 0, reasons: [] };
}

// メイン: クエリに対して候補タグをランク付け
export function searchTags(
  query: string,
  ctx: TagSearchContext,
  opts: { limit?: number; diversify?: boolean } = {},
): ScoredTag[] {
  const limit = opts.limit ?? 12;
  const diversify = opts.diversify ?? true;

  const trimmed = query.trim().replace(/^#/, '');
  if (trimmed.length < 1) return [];

  // クエリトークン化
  const tokens = tokenize(trimmed);
  const isMulti = tokens.length > 1;

  // 各トークンの variants を計算
  const variantsByToken = tokens.map((t) => {
    const v = generateVariants(t);
    return { token: t, variants: v, variantSet: new Set(v.map(normalize)) };
  });

  // 全クエリのバリアント合計 (アンカー判定用)
  const allVariants = new Set<string>();
  for (const { variantSet } of variantsByToken) {
    for (const v of variantSet) allVariants.add(v);
  }

  // 除外セット
  const blockedSet = new Set((ctx.blockedTags ?? []).map(normalize));
  const likedSet = new Set((ctx.likedTags ?? []).map(normalize));

  // 候補プール
  const pool = new Set<string>();
  for (const t of ctx.allTags) pool.add(t);
  for (const n of Object.values(ctx.nodes)) {
    pool.add(n.label);
    for (const a of n.aliases) pool.add(a);
    for (const r of (n.related ?? [])) pool.add(r);
  }
  for (const t of Object.keys(ctx.tagPopularity)) pool.add(t);

  // スコアリング
  const scored: ScoredTag[] = [];
  const seenN = new Set<string>();
  for (const candidate of pool) {
    const tn = normalize(candidate);
    if (blockedSet.has(tn) || seenN.has(tn)) continue;
    seenN.add(tn);

    // マルチトークン: 各トークンに対してスコアを計算
    // 全トークンがどれか1つ以上のシグナルでヒットした場合だけ採用
    const perToken = variantsByToken.map(({ token, variants, variantSet }) =>
      scoreTagForToken(candidate, token, variants, variantSet, ctx),
    );
    const hits = perToken.filter((p) => p.score > 0);
    if (hits.length === 0) continue;
    if (isMulti && hits.length < tokens.length) {
      // すべての token がヒットしてない場合、平均スコアを下げてペナルティ
      if (hits.length / tokens.length < 0.5) continue;
    }

    let score = 0;
    const reasons: string[] = [];
    for (const r of hits) {
      score += r.score;
      reasons.push(...r.reasons);
    }
    score = score / Math.max(1, tokens.length);

    // マルチトークン全ヒット ボーナス
    if (isMulti && hits.length === tokens.length) {
      score += 100;
      reasons.push('全マッチ');
    }

    // ブースト群
    // (i) 人気度 (log)
    const pop = ctx.tagPopularity[candidate] ?? 0;
    if (pop > 0) score += Math.log(1 + pop) * 3;

    // (ii) tagAffinity (ユーザーが過去にクリック)
    const aff = (ctx.tagAffinity ?? {})[candidate] ?? 0;
    if (aff > 0) score += Math.log(1 + aff) * 5;

    // (iii) liked タグの近接 (graph距離 1 = sibling/related)
    if (likedSet.size > 0) {
      let minDist = Infinity;
      for (const lt of (ctx.likedTags ?? [])) {
        const d = graphDistance(lt, candidate, ctx.nodes);
        if (d < minDist) minDist = d;
      }
      if (minDist === 1) score += 40;
      else if (minDist === 2) score += 20;
      else if (minDist === 3) score += 10;
    }

    // (iv) 共起活動量 (recent activity)
    const coo = ctx.cooccur[candidate];
    if (coo) {
      const cooTotal = Object.values(coo).reduce((a, b) => a + b, 0);
      score += Math.log(1 + cooTotal) * 1.5;
    }

    if (score > 0) {
      scored.push({
        tag: candidate,
        score,
        reasons: Array.from(new Set(reasons)),
        primaryReason: reasons[0] ?? '関連',
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  // ダイバーシフィケーション: 連続して類似度高すぎる候補は飛ばす
  if (!diversify) return scored.slice(0, limit);
  const picked: ScoredTag[] = [];
  for (const s of scored) {
    if (picked.length >= limit) break;
    // 既選択と類似しすぎ (sim >= 0.85) なら飛ばす
    const tooSimilar = picked.some((p) => damerauSimilarity(normalize(p.tag), normalize(s.tag)) >= 0.85);
    if (tooSimilar) continue;
    picked.push(s);
  }
  return picked;
}

// "Did you mean...?" — 一定スコア以上の最上位タグを1件返す
export function didYouMean(query: string, ctx: TagSearchContext): ScoredTag | null {
  const results = searchTags(query, ctx, { limit: 1, diversify: false });
  if (results.length === 0) return null;
  const top = results[0]!;
  // 完全一致でなく、かつ そこそこのスコアなら提案
  if (top.primaryReason === '完全一致') return null;
  if (top.score < 200) return null;
  return top;
}

// アクロニムも公開
export { acronym };

// HalfWidth helper (re-export)
export { fullToHalf } from './tokenize';
