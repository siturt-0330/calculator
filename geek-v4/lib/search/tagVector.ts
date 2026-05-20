// タグのベクトル表現と類似度計算
// 「タグをベクトル空間にマッピングして類似度で関連を発見」する設計
//
// 各タグは複数のシグナルからベクトルを構成:
// 1. グラフ明示連携 (alias / related / parent / sibling)  [強い]
// 2. 投稿での共起頻度 (協調フィルタ的)                    [中〜強]
// 3. 文字 n-gram 一致 (字面類似)                          [弱〜中]
// 4. 同義語辞書                                            [強]
// → コサイン類似度 (相当の) スコアでマージし「関連度」を算出

import type { TagNode } from '../../stores/tagGraphStore';
import { normalize } from './tokenize';

// 文字 2-gram / 3-gram fingerprint
function ngramSet(s: string, ns: number[] = [2, 3]): Set<string> {
  const out = new Set<string>();
  const norm = normalize(s);
  for (const n of ns) {
    if (norm.length < n) {
      out.add(norm);
      continue;
    }
    for (let i = 0; i <= norm.length - n; i++) out.add(norm.slice(i, i + n));
  }
  return out;
}

function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

// グラフ上での「明示的な近さ」
// alias = 1.0 / same parent = 0.85 / sibling = 0.7 / related = 0.65 / grandparent = 0.35
function graphAffinity(
  a: string,
  b: string,
  nodes: Record<string, TagNode>,
): number {
  // ノード索引: label / alias → nodeId
  const labelToId: Record<string, string> = {};
  for (const [id, n] of Object.entries(nodes)) {
    labelToId[normalize(n.label)] = id;
    for (const al of n.aliases) labelToId[normalize(al)] = id;
  }
  const idA = labelToId[normalize(a)];
  const idB = labelToId[normalize(b)];

  if (!idA || !idB) {
    // 片方しか graph にない: alias / related にもう一方が含まれるか
    for (const n of Object.values(nodes)) {
      const items = [n.label, ...n.aliases, ...(n.related ?? [])].map(normalize);
      if (items.includes(normalize(a)) && items.includes(normalize(b))) return 0.9;
    }
    return 0;
  }
  if (idA === idB) return 1.0; // 同一ノード (alias)

  const nodeA = nodes[idA];
  const nodeB = nodes[idB];
  if (!nodeA || !nodeB) return 0;

  // related 互いに登録?
  if ((nodeA.related ?? []).some((r) => normalize(r) === normalize(b))) return 0.85;
  if ((nodeB.related ?? []).some((r) => normalize(r) === normalize(a))) return 0.85;

  // 親子
  const parentOf: Record<string, string> = {};
  for (const [id, n] of Object.entries(nodes)) for (const c of n.children) parentOf[c] = id;

  if (parentOf[idA] === idB || parentOf[idB] === idA) return 0.75; // 親-子
  if (parentOf[idA] && parentOf[idA] === parentOf[idB]) return 0.7; // 兄弟
  // 祖父母
  if (parentOf[parentOf[idA]!] === idB || parentOf[parentOf[idB]!] === idA) return 0.4;
  // 親が共通祖父
  if (parentOf[parentOf[idA]!] && parentOf[parentOf[idA]!] === parentOf[parentOf[idB]!]) return 0.3;
  return 0;
}

// 共起ベースの類似度 (正規化済み)
function cooccurAffinity(
  a: string,
  b: string,
  cooccur: Record<string, Record<string, number>>,
): number {
  const aRow = cooccur[a] ?? cooccur[normalize(a)];
  if (!aRow) return 0;
  const v = aRow[b] ?? aRow[normalize(b)] ?? 0;
  if (v === 0) return 0;
  // 正規化: log(co-occur) / log(max co-occur)
  const max = Math.max(...Object.values(aRow));
  return Math.log(1 + v) / Math.log(1 + max);
}

// メイン: 2タグ間の総合類似度 (0..1)
export function tagSimilarity(
  a: string,
  b: string,
  ctx: {
    nodes: Record<string, TagNode>;
    cooccur: Record<string, Record<string, number>>;
    synonyms?: Record<string, string[]>;
  },
): { score: number; signals: string[] } {
  if (normalize(a) === normalize(b)) return { score: 1, signals: ['同一'] };
  const signals: string[] = [];

  const graphS = graphAffinity(a, b, ctx.nodes);
  if (graphS > 0) signals.push('graph');

  const cooS = cooccurAffinity(a, b, ctx.cooccur);
  if (cooS > 0) signals.push('共起');

  const charS = jaccard(ngramSet(a), ngramSet(b));
  if (charS > 0.4) signals.push('字面');

  let synonymS = 0;
  if (ctx.synonyms) {
    for (const [key, syns] of Object.entries(ctx.synonyms)) {
      const allKeys = [key, ...syns].map(normalize);
      if (allKeys.includes(normalize(a)) && allKeys.includes(normalize(b))) {
        synonymS = 1.0;
        signals.push('同義語');
        break;
      }
    }
  }

  // 重みづけ合算: 最大を base にしつつ、他があれば加算 (上限 1)
  const weighted = Math.max(
    graphS,
    cooS * 0.85,
    charS * 0.5,
    synonymS,
  ) + Math.min(0.15, cooS * 0.1 + charS * 0.05);
  return { score: Math.min(1, weighted), signals };
}

// あるタグに対して関連度の高い候補を上位 K 件返す
export function findRelatedTags(
  query: string,
  candidates: string[],
  ctx: {
    nodes: Record<string, TagNode>;
    cooccur: Record<string, Record<string, number>>;
    synonyms?: Record<string, string[]>;
  },
  options: { topK?: number; minScore?: number } = {},
): { tag: string; score: number; signals: string[] }[] {
  const { topK = 20, minScore = 0.2 } = options;
  const seen = new Set<string>([normalize(query)]);
  const scored = candidates
    .filter((c) => !seen.has(normalize(c)))
    .map((c) => {
      const r = tagSimilarity(query, c, ctx);
      return { tag: c, score: r.score, signals: r.signals };
    })
    .filter((r) => r.score >= minScore);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
