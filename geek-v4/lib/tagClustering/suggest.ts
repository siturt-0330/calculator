// ============================================================
// tagClustering/suggest.ts — タグ自動グルーピング候補抽出
// ============================================================
// アルゴリズム:
//   入力:
//     - interestTags: ユーザーの興味タグ集合 (likedTags ∪ graph 内タグ)
//     - cooccur:      tag → { otherTag → 共起回数 } (tagCooccurStore)
//     - inGraphTags:  既に tagGraph に登録済みのタグ集合 (= 提案から除外)
//     - variants:     tag → variants map (generateVariants の結果)
//
//   ステップ:
//     1) interestTags 内の任意ペアの cooccur 回数を集計
//        + 表記揺れ (variants) で結合した場合の追加ボーナス
//     2) 各タグの "hub 度" = (隣接タグ数 + 重み付き) を計算
//     3) hub の高いタグから greedy にクラスタを構成
//        - hub の近傍を高スコア順に取り出し、最大 6 個まで
//        - 既に使用済み / graph 内のタグは skip
//        - hub 自身も近傍も「interestTags」に含まれていないと skip
//     4) confidence = クラスタ内の平均共起スコア + variant ヒット boost
//     5) confidence 降順で上位 5 件を返す
//
//   出力:
//     SuggestedCluster[] = {
//       tags: string[],         // [hub, ...members] 順
//       hub: string,            // クラスタの中心
//       confidence: 0..1,
//       signals: { avgCooccur, variantPairs, ... },
//     }
//
//   なぜこの方式か:
//     - union-find や DBSCAN は実装重く Phase 1 over-engineering
//     - hub-based greedy は説明性が高い (「このタグを中心にしました」と提示できる)
//     - O(N²) だが interestTags は通常 < 50 で実用 (max 2,500 ペア比較)
//     - Phase 2 で server-side compute に移行する時も同じ概念が使える
// ============================================================

import { deepNormalize } from '../search/tokenize';
import { generateVariants } from '../search/variants';

export type CooccurMap = Record<string, Record<string, number>>;

export type SuggestedCluster = {
  hub: string;          // 中心タグ (元表記)
  tags: string[];       // [hub, ...members] (元表記)
  confidence: number;   // 0..1
  signals: {
    avgCooccur: number;     // hub と member 間の平均共起回数
    variantPairs: number;   // 同 cluster 内で variant 関係にあるペア数
    memberCount: number;
  };
};

export type SuggestInput = {
  interestTags: string[];          // 元表記 (重複あり可)
  cooccur: CooccurMap;             // 共起マップ
  inGraphTags: ReadonlySet<string>; // 既存ノード集合 (除外用)
  // tuning
  minCooccur?: number;             // ペアとして見なす最小共起回数 (default 2)
  minClusterSize?: number;         // クラスタの最小サイズ (default 3)
  maxClusterSize?: number;         // クラスタの最大サイズ (default 6)
  maxClusters?: number;            // 返却上限 (default 5)
};

export function suggestClusters(input: SuggestInput): SuggestedCluster[] {
  const minCooccur = input.minCooccur ?? 2;
  const minClusterSize = input.minClusterSize ?? 3;
  const maxClusterSize = input.maxClusterSize ?? 6;
  const maxClusters = input.maxClusters ?? 5;

  // 表記揺れを吸収して dedup — display は元表記、内部処理は normalize
  const origByNorm = new Map<string, string>();
  for (const raw of input.interestTags) {
    const n = deepNormalize(raw);
    if (n && !origByNorm.has(n)) origByNorm.set(n, raw);
  }
  const inGraphNorm = new Set<string>();
  for (const g of input.inGraphTags) {
    const n = deepNormalize(g);
    if (n) inGraphNorm.add(n);
  }
  // interest から「既に graph 入り」のタグは除外
  const pool = Array.from(origByNorm.keys()).filter((n) => !inGraphNorm.has(n));
  if (pool.length < minClusterSize) return [];

  // cooccur lookup を正規化キーで引けるように作り直す
  const cooccurNorm: CooccurMap = {};
  for (const [a, neighbors] of Object.entries(input.cooccur)) {
    const an = deepNormalize(a);
    if (!an) continue;
    for (const [b, count] of Object.entries(neighbors)) {
      const bn = deepNormalize(b);
      if (!bn || an === bn) continue;
      if (!cooccurNorm[an]) cooccurNorm[an] = {};
      cooccurNorm[an]![bn] = Math.max(cooccurNorm[an]![bn] ?? 0, count);
    }
  }

  // variant set per tag (small cache to avoid recompute)
  const variantSet = new Map<string, Set<string>>();
  const variantsFor = (norm: string): Set<string> => {
    const cached = variantSet.get(norm);
    if (cached) return cached;
    const orig = origByNorm.get(norm) ?? norm;
    const vs = new Set(generateVariants(orig).map(deepNormalize).filter(Boolean));
    variantSet.set(norm, vs);
    return vs;
  };

  // 隣接マップ構築 (cooccur >= minCooccur のペアのみ)
  // edge.score は cooccur に variant bonus を上乗せ
  const adj = new Map<string, Map<string, number>>();
  for (let i = 0; i < pool.length; i++) {
    const a = pool[i]!;
    for (let j = i + 1; j < pool.length; j++) {
      const b = pool[j]!;
      const ab = cooccurNorm[a]?.[b] ?? 0;
      const ba = cooccurNorm[b]?.[a] ?? 0;
      const cooccurCount = Math.max(ab, ba);
      const variantHit =
        variantsFor(a).has(b) || variantsFor(b).has(a) ? 1 : 0;
      // variant でつながっているなら cooccur 0 でも score 3 (=「弱い実体共起」相当)
      const score = cooccurCount + variantHit * 3;
      if (score < minCooccur && variantHit === 0) continue;
      if (!adj.has(a)) adj.set(a, new Map());
      if (!adj.has(b)) adj.set(b, new Map());
      adj.get(a)!.set(b, score);
      adj.get(b)!.set(a, score);
    }
  }

  // hub 度 = 隣接タグ数 + 隣接 score 合計 × 0.1
  const hubScores: Array<{ tag: string; degree: number; sumScore: number }> = [];
  for (const [tag, neighbors] of adj) {
    let sum = 0;
    for (const s of neighbors.values()) sum += s;
    hubScores.push({ tag, degree: neighbors.size, sumScore: sum });
  }
  hubScores.sort((a, b) => {
    if (b.degree !== a.degree) return b.degree - a.degree;
    return b.sumScore - a.sumScore;
  });

  // hub-based greedy clustering
  const used = new Set<string>();
  const clusters: SuggestedCluster[] = [];
  for (const h of hubScores) {
    if (clusters.length >= maxClusters) break;
    if (used.has(h.tag)) continue;
    // hub に近傍が minClusterSize-1 個無いと skip
    if (h.degree < minClusterSize - 1) continue;

    const members: string[] = [h.tag];
    used.add(h.tag);

    const sortedNeighbors = Array.from(adj.get(h.tag)!.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([t]) => t);

    let variantPairs = 0;
    let sumCooccur = 0;
    let cooccurPairs = 0;

    for (const n of sortedNeighbors) {
      if (members.length >= maxClusterSize) break;
      if (used.has(n)) continue;
      const edgeScore = adj.get(h.tag)?.get(n) ?? 0;
      const isVariant = variantsFor(h.tag).has(n) || variantsFor(n).has(h.tag);
      // variant 関係なら +3 のボーナスが含まれているので差し引いて素の cooccur を得る
      const rawCooccur = isVariant ? edgeScore - 3 : edgeScore;
      sumCooccur += Math.max(0, rawCooccur);
      cooccurPairs++;
      if (isVariant) variantPairs++;
      members.push(n);
      used.add(n);
    }

    if (members.length < minClusterSize) {
      // 失敗 — used を戻して次の hub へ
      for (const m of members) used.delete(m);
      continue;
    }

    const avgCooccur = cooccurPairs > 0 ? sumCooccur / cooccurPairs : 0;
    // confidence: 0..1 に正規化
    //   - avgCooccur: 0..15 程度を想定 → 0..0.7 に
    //   - variantPairs: 1 ペア = +0.1, 2 ペア = +0.2, 上限 +0.3
    const confidence = Math.min(
      1,
      Math.tanh(avgCooccur / 12) * 0.7 + Math.min(variantPairs, 3) * 0.1,
    );

    clusters.push({
      hub: origByNorm.get(h.tag) ?? h.tag,
      tags: members.map((m) => origByNorm.get(m) ?? m),
      confidence,
      signals: {
        avgCooccur,
        variantPairs,
        memberCount: members.length,
      },
    });
  }

  // confidence 降順
  clusters.sort((a, b) => b.confidence - a.confidence);
  return clusters;
}
