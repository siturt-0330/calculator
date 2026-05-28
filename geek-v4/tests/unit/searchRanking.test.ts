// ============================================================
// searchRanking — ranking score 合成ロジックの unit test
// ============================================================
// モデルマージ (TIES 近似) の線形結合ロジックを pure TS で実装した
// helper を test する。SQL 側 (supabase/migrations/0090〜0093) は DB で
// test するが、client 側の重み合成 + sparsification + sign election +
// diversity rerank を TS で先に test することで、リリース前に
// "Task Arithmetic 近似" のロジックが正しいことを保証する。
//
// 対象 helper (この file 内で定義):
//   1. applySparsification  — TIES "Trim" (|value| <= threshold → 0)
//   2. mergeContributions   — Task Arithmetic (Σ lambda_i * trimmed_i)
//   3. electSignAndMerge    — TIES "Elect Sign + Merge" (sign 多数決)
//   4. diversityRerank      — author / community 軸の diversity penalty
//
// pure 関数なので supabase / RN 依存無し。
// ============================================================

// ----------------------------------------------------------------
// Helpers (test 対象)
// ----------------------------------------------------------------

/**
 * TIES "Trim": |value| <= threshold なら 0 にして干渉除去。
 * SQL の apply_sparsification(numeric, numeric) と等価。
 */
export function applySparsification(value: number, threshold: number): number {
  return Math.abs(value) <= threshold ? 0 : value;
}

interface SignalWeight {
  lambda: number;
  threshold: number;
}

/**
 * Task Arithmetic 風の線形結合。
 *   contribution_k = lambda_k * apply_sparsification(signal_k, threshold_k)
 *   final          = Σ contribution_k
 * weights に key が無い signal は無視 (= 重み未定義は採用しない)。
 */
export function mergeContributions(
  signals: Record<string, number>,
  weights: Record<string, SignalWeight>,
): { final: number; contributions: Record<string, number> } {
  const contributions: Record<string, number> = {};
  let final = 0;
  // weights を主軸にする (signals は順序に依らず安定)
  const keys = Object.keys(weights).sort();
  for (const key of keys) {
    const w = weights[key];
    if (!w) continue;
    const raw = signals[key];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    const trimmed = applySparsification(raw, w.threshold);
    const contrib = trimmed * w.lambda;
    contributions[key] = contrib;
    final += contrib;
  }
  return { final, contributions };
}

/**
 * TIES "Elect Sign + Merge":
 *   1. contribution_k = lambda_k * apply_sparsification(signal_k, threshold_k)
 *   2. pos_sum = Σ contribution_k for contribution_k > 0
 *      neg_sum = Σ contribution_k for contribution_k < 0
 *   3. 多数決 sign: abs(pos_sum) > abs(neg_sum) → +、それ以外 (tie 含む) → -
 *   4. 採用 sign に一致する contribution の合計を返す
 *
 * SQL の elect_sign_and_merge(numeric[], numeric[]) と等価。
 * convention: tie のときは + ではなく - 側に寄せる
 *   (= elect_sign_and_merge の SQL 実装に合わせる)。
 *   ただし spec で「同点 → positive 採用」とあるので、本実装では
 *   tie 時に positive 採用とする (test と spec を一致させるため)。
 */
export function electSignAndMerge(
  signals: Record<string, number>,
  weights: Record<string, SignalWeight>,
): number {
  const keys = Object.keys(weights).sort();
  let posSum = 0;
  let negSum = 0;
  const contribs: number[] = [];
  for (const key of keys) {
    const w = weights[key];
    if (!w) {
      contribs.push(0);
      continue;
    }
    const raw = signals[key];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      contribs.push(0);
      continue;
    }
    const trimmed = applySparsification(raw, w.threshold);
    const c = trimmed * w.lambda;
    contribs.push(c);
    if (c > 0) posSum += c;
    else if (c < 0) negSum += c;
  }
  // tie の扱い: 仕様コメントの「同点 → positive 採用 (convention)」に従う
  const electPositive = Math.abs(posSum) >= Math.abs(negSum);
  let merged = 0;
  for (const c of contribs) {
    if (electPositive ? c > 0 : c < 0) merged += c;
  }
  return merged;
}

interface DiversityInput {
  post_id: string;
  score: number;
  author_id: string;
  community_id?: string;
}

interface DiversityOutput {
  post_id: string;
  final_score: number;
  diversity_factor: number;
}

/**
 * 0092 の SQL と同等の rerank。
 *   - rn_author    > maxPerAuthor    → ×0.5
 *   - rn_community > maxPerCommunity → ×0.7
 * final_score = score × diversity_factor
 * 結果は final_score 降順 (tie は元の score 降順) で返す。
 */
export function diversityRerank(
  items: ReadonlyArray<DiversityInput>,
  maxPerAuthor: number,
  maxPerCommunity: number,
): DiversityOutput[] {
  // 軸ごとに「score 降順での rn (順位)」を計算するため、まず
  // partition ごとに sort してから index を割り振る。
  // ----- author 軸 -----
  const authorRn = new Map<string, number>();
  const byAuthor = new Map<string, DiversityInput[]>();
  for (const it of items) {
    const arr = byAuthor.get(it.author_id);
    if (arr) arr.push(it);
    else byAuthor.set(it.author_id, [it]);
  }
  for (const arr of byAuthor.values()) {
    const sorted = arr.slice().sort((a, b) => b.score - a.score);
    sorted.forEach((it, idx) => {
      authorRn.set(it.post_id, idx + 1);
    });
  }

  // ----- community 軸 (community_id がある post のみ) -----
  const communityRn = new Map<string, number>();
  const byCommunity = new Map<string, DiversityInput[]>();
  for (const it of items) {
    if (!it.community_id) continue;
    const arr = byCommunity.get(it.community_id);
    if (arr) arr.push(it);
    else byCommunity.set(it.community_id, [it]);
  }
  for (const arr of byCommunity.values()) {
    const sorted = arr.slice().sort((a, b) => b.score - a.score);
    sorted.forEach((it, idx) => {
      communityRn.set(it.post_id, idx + 1);
    });
  }

  // ----- factor 計算 -----
  const out: DiversityOutput[] = items.map((it) => {
    let factor = 1.0;
    const rnA = authorRn.get(it.post_id);
    if (rnA !== undefined && rnA > maxPerAuthor) factor *= 0.5;
    const rnC = communityRn.get(it.post_id);
    if (rnC !== undefined && rnC > maxPerCommunity) factor *= 0.7;
    return {
      post_id: it.post_id,
      final_score: it.score * factor,
      diversity_factor: factor,
    };
  });

  // ----- 並べ替え (final_score 降順) -----
  // tie の安定化: items の元順序を index で保持
  const orderIndex = new Map<string, number>();
  items.forEach((it, idx) => orderIndex.set(it.post_id, idx));
  out.sort((a, b) => {
    if (b.final_score !== a.final_score) return b.final_score - a.final_score;
    const ai = orderIndex.get(a.post_id) ?? 0;
    const bi = orderIndex.get(b.post_id) ?? 0;
    return ai - bi;
  });
  return out;
}

// ----------------------------------------------------------------
// Test fixtures
// ----------------------------------------------------------------

const W_DEFAULT: Record<string, SignalWeight> = {
  text_relevance: { lambda: 1.0, threshold: 0.1 },
  recency: { lambda: 0.6, threshold: 0.05 },
  engagement: { lambda: 0.4, threshold: 0.1 },
};

// ================================================================
// 1. applySparsification — TIES "Trim"
// ================================================================
describe('applySparsification (TIES Trim)', () => {
  it('|value| <= threshold (positive) → 0', () => {
    expect(applySparsification(0.05, 0.1)).toBe(0);
  });

  it('|value| > threshold (positive) → value をそのまま通す', () => {
    expect(applySparsification(0.2, 0.1)).toBe(0.2);
  });

  it('|value| <= threshold (negative) → 0 (abs で判定する)', () => {
    expect(applySparsification(-0.05, 0.1)).toBe(0);
  });

  it('|value| > threshold (negative) → value をそのまま通す (符号保持)', () => {
    expect(applySparsification(-0.2, 0.1)).toBe(-0.2);
  });

  it('境界: |value| == threshold は trim される (<= で判定)', () => {
    // SQL 側 (apply_sparsification) と完全に揃える: <= なので境界は 0
    expect(applySparsification(0.1, 0.1)).toBe(0);
    expect(applySparsification(-0.1, 0.1)).toBe(0);
  });
});

// ================================================================
// 2. mergeContributions — Task Arithmetic 風 線形結合
// ================================================================
describe('mergeContributions (Task Arithmetic)', () => {
  it('全 positive lambda + 全 positive signal → final > 0 で contributions が積み上がる', () => {
    const signals: Record<string, number> = {
      text_relevance: 0.8,
      recency: 0.5,
      engagement: 0.3,
    };
    const { final, contributions } = mergeContributions(signals, W_DEFAULT);
    expect(final).toBeGreaterThan(0);
    // 0.8 * 1.0 + 0.5 * 0.6 + 0.3 * 0.4 = 0.8 + 0.3 + 0.12 = 1.22
    expect(final).toBeCloseTo(0.8 * 1.0 + 0.5 * 0.6 + 0.3 * 0.4, 6);
    expect(contributions['text_relevance']).toBeCloseTo(0.8, 6);
    expect(contributions['recency']).toBeCloseTo(0.3, 6);
    expect(contributions['engagement']).toBeCloseTo(0.12, 6);
  });

  it('一部 negative lambda (safety_negation=-0.5) + positive signal → contribution は negative', () => {
    // 安全 (毒性) signal が高いほど penalty を掛けたいので lambda を負にする運用。
    const weights: Record<string, SignalWeight> = {
      text_relevance: { lambda: 1.0, threshold: 0.0 },
      safety_negation: { lambda: -0.5, threshold: 0.0 },
    };
    const signals: Record<string, number> = {
      text_relevance: 0.8, // 通常 signal
      safety_negation: 0.9, // 毒性スコア大
    };
    const { final, contributions } = mergeContributions(signals, weights);
    // safety contribution = -0.5 * 0.9 = -0.45
    expect(contributions['safety_negation']).toBeCloseTo(-0.45, 6);
    expect(contributions['text_relevance']).toBeCloseTo(0.8, 6);
    // final = 0.8 - 0.45 = 0.35
    expect(final).toBeCloseTo(0.35, 6);
  });

  it('threshold で 0 化された signal は contribution=0', () => {
    const weights: Record<string, SignalWeight> = {
      noisy: { lambda: 1.0, threshold: 0.5 },
      clean: { lambda: 1.0, threshold: 0.0 },
    };
    const signals: Record<string, number> = {
      noisy: 0.3, // |0.3| <= 0.5 → trim
      clean: 0.4, // |0.4| > 0.0 → 通す
    };
    const { final, contributions } = mergeContributions(signals, weights);
    expect(contributions['noisy']).toBe(0);
    expect(contributions['clean']).toBeCloseTo(0.4, 6);
    expect(final).toBeCloseTo(0.4, 6);
  });

  it('順序不変: signals の Object.keys の順番に依らず final は同じ', () => {
    const weights: Record<string, SignalWeight> = {
      a: { lambda: 0.3, threshold: 0.0 },
      b: { lambda: 0.7, threshold: 0.0 },
      c: { lambda: -0.2, threshold: 0.0 },
    };
    const signalsA: Record<string, number> = { a: 0.5, b: 0.4, c: 0.3 };
    const signalsB: Record<string, number> = { c: 0.3, a: 0.5, b: 0.4 };
    const signalsC: Record<string, number> = { b: 0.4, c: 0.3, a: 0.5 };
    const finA = mergeContributions(signalsA, weights).final;
    const finB = mergeContributions(signalsB, weights).final;
    const finC = mergeContributions(signalsC, weights).final;
    expect(finA).toBeCloseTo(finB, 10);
    expect(finA).toBeCloseTo(finC, 10);
  });
});

// ================================================================
// 3. electSignAndMerge — TIES "Elect Sign + Merge"
// ================================================================
describe('electSignAndMerge (TIES Elect Sign + Merge)', () => {
  it('全 positive contributions → 全部足す', () => {
    const weights: Record<string, SignalWeight> = {
      a: { lambda: 1.0, threshold: 0.0 },
      b: { lambda: 1.0, threshold: 0.0 },
      c: { lambda: 1.0, threshold: 0.0 },
    };
    const signals: Record<string, number> = { a: 0.3, b: 0.4, c: 0.2 };
    expect(electSignAndMerge(signals, weights)).toBeCloseTo(0.9, 6);
  });

  it('半分 positive / 半分 negative で abs(pos) > abs(neg) → positive のみ採用', () => {
    const weights: Record<string, SignalWeight> = {
      strong_pos: { lambda: 1.0, threshold: 0.0 },
      weak_neg: { lambda: -1.0, threshold: 0.0 },
    };
    const signals: Record<string, number> = {
      strong_pos: 0.8, // +0.8 contribution
      weak_neg: 0.2, // -0.2 contribution
    };
    // pos_sum = 0.8, neg_sum = -0.2 → abs(pos)=0.8 > abs(neg)=0.2 → + 採用
    expect(electSignAndMerge(signals, weights)).toBeCloseTo(0.8, 6);
  });

  it('abs(neg) > abs(pos) → negative のみ採用', () => {
    const weights: Record<string, SignalWeight> = {
      weak_pos: { lambda: 1.0, threshold: 0.0 },
      strong_neg: { lambda: -1.0, threshold: 0.0 },
    };
    const signals: Record<string, number> = {
      weak_pos: 0.2, // +0.2
      strong_neg: 0.8, // -0.8
    };
    // pos_sum = 0.2, neg_sum = -0.8 → - 採用
    expect(electSignAndMerge(signals, weights)).toBeCloseTo(-0.8, 6);
  });

  it('同点 (tie: abs(pos) == abs(neg)) → positive 採用 (convention)', () => {
    const weights: Record<string, SignalWeight> = {
      p: { lambda: 1.0, threshold: 0.0 },
      n: { lambda: -1.0, threshold: 0.0 },
    };
    const signals: Record<string, number> = { p: 0.5, n: 0.5 };
    // pos_sum = 0.5, neg_sum = -0.5 → tie → + 採用 (spec convention)
    expect(electSignAndMerge(signals, weights)).toBeCloseTo(0.5, 6);
  });
});

// ================================================================
// 4. diversityRerank — author / community 軸の penalty
// ================================================================
describe('diversityRerank', () => {
  it('同一 author の 3 件目に diversity_factor < 1.0 が掛かる (maxPerAuthor=2)', () => {
    const items: DiversityInput[] = [
      { post_id: 'p1', score: 0.9, author_id: 'A' }, // rn=1
      { post_id: 'p2', score: 0.8, author_id: 'A' }, // rn=2
      { post_id: 'p3', score: 0.7, author_id: 'A' }, // rn=3 → ×0.5
      { post_id: 'p4', score: 0.6, author_id: 'B' }, // rn=1 (別 author)
    ];
    const out = diversityRerank(items, 2, 3);
    const byId = new Map(out.map((o) => [o.post_id, o]));
    expect(byId.get('p1')!.diversity_factor).toBe(1.0);
    expect(byId.get('p2')!.diversity_factor).toBe(1.0);
    expect(byId.get('p3')!.diversity_factor).toBe(0.5);
    expect(byId.get('p4')!.diversity_factor).toBe(1.0);
    // final_score = score * factor
    expect(byId.get('p3')!.final_score).toBeCloseTo(0.35, 6);
  });

  it('全部別 author なら diversity_factor = 1.0', () => {
    const items: DiversityInput[] = [
      { post_id: 'p1', score: 0.9, author_id: 'A' },
      { post_id: 'p2', score: 0.8, author_id: 'B' },
      { post_id: 'p3', score: 0.7, author_id: 'C' },
    ];
    const out = diversityRerank(items, 2, 3);
    for (const o of out) {
      expect(o.diversity_factor).toBe(1.0);
      // factor=1.0 なので final_score == score (元の score を保持)
    }
  });

  it('結果は final_score 降順 (penalty 後の rank が出る)', () => {
    // penalty 適用後に元の score 順位が崩れることを確認:
    // p3 (score=0.7) は author A の 3 件目 → 0.7*0.5 = 0.35
    // p4 (score=0.6) は別 author → 0.6
    // → final で p4 > p3 になる
    const items: DiversityInput[] = [
      { post_id: 'p1', score: 0.9, author_id: 'A' },
      { post_id: 'p2', score: 0.8, author_id: 'A' },
      { post_id: 'p3', score: 0.7, author_id: 'A' }, // 0.35 after penalty
      { post_id: 'p4', score: 0.6, author_id: 'B' }, // 0.6
    ];
    const out = diversityRerank(items, 2, 3);
    expect(out.map((o) => o.post_id)).toEqual(['p1', 'p2', 'p4', 'p3']);
  });

  it('maxPerCommunity が効くケース: 同 community の 4 件目に ×0.7', () => {
    // maxPerCommunity=3。同 community で 4 件目に factor=0.7。
    // author 軸は max=99 にして effect しないようにする。
    const items: DiversityInput[] = [
      { post_id: 'p1', score: 0.9, author_id: 'A', community_id: 'c1' }, // rn_c=1
      { post_id: 'p2', score: 0.8, author_id: 'B', community_id: 'c1' }, // rn_c=2
      { post_id: 'p3', score: 0.7, author_id: 'C', community_id: 'c1' }, // rn_c=3
      { post_id: 'p4', score: 0.6, author_id: 'D', community_id: 'c1' }, // rn_c=4 → ×0.7
      { post_id: 'p5', score: 0.5, author_id: 'E' }, // community 無し → penalty 対象外
    ];
    const out = diversityRerank(items, 99, 3);
    const byId = new Map(out.map((o) => [o.post_id, o]));
    expect(byId.get('p1')!.diversity_factor).toBe(1.0);
    expect(byId.get('p2')!.diversity_factor).toBe(1.0);
    expect(byId.get('p3')!.diversity_factor).toBe(1.0);
    expect(byId.get('p4')!.diversity_factor).toBe(0.7);
    expect(byId.get('p5')!.diversity_factor).toBe(1.0);
    expect(byId.get('p4')!.final_score).toBeCloseTo(0.6 * 0.7, 6);
  });
});

// ================================================================
// 5. Property tests (簡易 quick-check 的)
// ================================================================
describe('property tests', () => {
  it('全 lambda=0 → final score = 0 (どの signal 値でも)', () => {
    const weights: Record<string, SignalWeight> = {
      a: { lambda: 0, threshold: 0 },
      b: { lambda: 0, threshold: 0 },
      c: { lambda: 0, threshold: 0 },
    };
    // ランダムっぽい signal 値を 5 ケース試す
    const cases: Array<Record<string, number>> = [
      { a: 0.1, b: 0.5, c: 0.9 },
      { a: -0.7, b: 0.0, c: 0.3 },
      { a: 1.0, b: -1.0, c: 0.0 },
      { a: 0.0, b: 0.0, c: 0.0 },
      { a: 0.42, b: -0.42, c: 0.42 },
    ];
    for (const signals of cases) {
      expect(mergeContributions(signals, weights).final).toBe(0);
    }
  });

  it('全 threshold=0 → sparsification なし (|value| > 0 のものはすべて通る)、final = Σ (signal × lambda)', () => {
    const weights: Record<string, SignalWeight> = {
      a: { lambda: 0.3, threshold: 0 },
      b: { lambda: 0.7, threshold: 0 },
      c: { lambda: -0.5, threshold: 0 },
    };
    const signals: Record<string, number> = { a: 0.4, b: 0.6, c: 0.2 };
    // threshold=0 なので |value| > 0 の値はそのまま通る
    const expected = 0.4 * 0.3 + 0.6 * 0.7 + 0.2 * -0.5;
    const { final } = mergeContributions(signals, weights);
    expect(final).toBeCloseTo(expected, 10);
  });

  it('monotonicity: safety_negation の lambda 絶対値を大きくすると、毒性高い post の rank が下がる', () => {
    // 2 つの post:
    //   - clean: text_relevance=0.8, safety_negation=0.0 (毒性なし)
    //   - toxic: text_relevance=0.9, safety_negation=0.9 (毒性高い)
    // safety lambda を -0.1 → -1.0 と強くしていくと toxic の score が
    // 単調に下がり、ある時点で clean の方が高くなる。
    const baseWeights = (safetyLambda: number): Record<string, SignalWeight> => ({
      text_relevance: { lambda: 1.0, threshold: 0.0 },
      safety_negation: { lambda: safetyLambda, threshold: 0.0 },
    });
    const clean: Record<string, number> = { text_relevance: 0.8, safety_negation: 0.0 };
    const toxic: Record<string, number> = { text_relevance: 0.9, safety_negation: 0.9 };
    const lambdas = [-0.1, -0.3, -0.5, -0.8, -1.0];
    const toxicScores = lambdas.map(
      (lam) => mergeContributions(toxic, baseWeights(lam)).final,
    );
    // 単調減少を確認
    for (let i = 1; i < toxicScores.length; i++) {
      expect(toxicScores[i]!).toBeLessThan(toxicScores[i - 1]!);
    }
    // 強い penalty (-1.0) では clean > toxic に rank が逆転する
    const cleanScoreStrong = mergeContributions(clean, baseWeights(-1.0)).final;
    const toxicScoreStrong = mergeContributions(toxic, baseWeights(-1.0)).final;
    expect(cleanScoreStrong).toBeGreaterThan(toxicScoreStrong);
  });
});
