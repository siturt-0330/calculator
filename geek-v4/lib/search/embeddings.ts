// ============================================================
// 共起ベース セマンティック埋め込み (PMI + Cosine Similarity)
// ============================================================
// 各タグについて、共起マトリクスから PMI (Pointwise Mutual Information)
// で重み付けされたスパース ベクトルを構築。コサイン類似度で意味的な近さを計算。
//
// PMI(a, b) = log( p(a,b) / (p(a) * p(b)) )
//   - p(a, b) は a と b が同じ投稿に同時出現する確率
//   - p(a), p(b) は各単独確率
//   - 0 を下回る PMI (反相関) は捨てる (positive PMI only)
//
// これにより、形が似てないが文脈的に近いタグも検索ヒットする。
// 例: クエリ "サッカー" → "Jリーグ" / "ワールドカップ" / "三笘薫"
// ============================================================

export type EmbeddingVector = Map<string, number>;

// 共起マトリクスからタグごとに PMI ベクトルを生成
// 結果は Map: tag → EmbeddingVector (sparse)
export function buildEmbeddings(
  cooccur: Record<string, Record<string, number>>,
  tagPopularity: Record<string, number>,
): Map<string, EmbeddingVector> {
  const result = new Map<string, EmbeddingVector>();
  // 全体の総出現数 (= 各タグの popularity の合計)
  const totalCount = Object.values(tagPopularity).reduce((a, b) => a + b, 0);
  if (totalCount === 0) return result;

  for (const [tagA, row] of Object.entries(cooccur)) {
    const popA = Math.max(1, tagPopularity[tagA] ?? 0);
    const vec: EmbeddingVector = new Map();
    for (const [tagB, cooccurCount] of Object.entries(row)) {
      if (tagA === tagB || cooccurCount < 1) continue;
      const popB = Math.max(1, tagPopularity[tagB] ?? 0);
      // PMI = log( p(a,b) / (p(a) * p(b)) )
      //     = log( cooccurCount / total ) - log( popA / total ) - log( popB / total )
      //     = log( cooccurCount * total / (popA * popB) )
      const pmi = Math.log((cooccurCount * totalCount) / (popA * popB));
      if (pmi > 0) vec.set(tagB, pmi);
    }
    if (vec.size > 0) result.set(tagA, vec);
  }
  return result;
}

// スパースベクトルのコサイン類似度
export function cosineSim(a: EmbeddingVector, b: EmbeddingVector): number {
  if (a.size === 0 || b.size === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const v of a.values()) normA += v * v;
  for (const v of b.values()) normB += v * v;
  if (normA === 0 || normB === 0) return 0;
  // 小さい方をループする
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const [k, vs] of small) {
    const vb = big.get(k);
    if (vb !== undefined) dot += vs * vb;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// 同義語ボーナス: クエリ単独タグに対して上位 K の意味的近傍タグを返す
export function findSemanticNeighbors(
  tag: string,
  embeddings: Map<string, EmbeddingVector>,
  topK = 10,
  minSim = 0.15,
): Array<{ tag: string; sim: number }> {
  const queryVec = embeddings.get(tag);
  if (!queryVec) return [];
  const scored: Array<{ tag: string; sim: number }> = [];
  for (const [other, vec] of embeddings) {
    if (other === tag) continue;
    const s = cosineSim(queryVec, vec);
    if (s >= minSim) scored.push({ tag: other, sim: s });
  }
  scored.sort((a, b) => b.sim - a.sim);
  return scored.slice(0, topK);
}
