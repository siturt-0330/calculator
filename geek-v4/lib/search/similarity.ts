// 名前の類似判定 — コミュニティ作成時の近重複防止に使う。
//
// 戦略:
//   1) 正規化 (全角→半角、大小、カタカナ→ひらがな統一)
//   2) Jaccard 2-gram スコア + 完全一致 / 包含 / 編集距離 で多段判定
//   3) 0.65 以上を「類似」と判断 (経験則的に false positive と false negative の
//      バランスが良い閾値)
//
// "==LOVE" "≒LOVE" "イコールラブ" 等を寄せたいので前処理で記号も読みに展開する。

import {
  normalize, ngrams, fullToHalf, katakanaToHiragana,
} from './tokenize';

const SIM_THRESHOLD = 0.65;

// 検索精度向上のための前処理:
// 1) 全角→半角
// 2) 小文字
// 3) カタカナ→ひらがな (検索ゆらぎ吸収)
// 4) 空白・記号除去
function deepNormalize(s: string): string {
  return katakanaToHiragana(fullToHalf(s).toLowerCase()).replace(/[\s　,.、。!?！？「」『』()（）\[\]\/\\#&|·・]+/g, '');
}

// レーベンシュタイン距離 (短い文字列に強い、O(m*n))
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  // 早期 reject: 長さの差が大きいなら高い距離
  const lenDiff = Math.abs(a.length - b.length);
  if (lenDiff > Math.max(a.length, b.length) * 0.8) return Math.max(a.length, b.length);

  const v0 = new Array(b.length + 1);
  const v1 = new Array(b.length + 1);
  for (let i = 0; i <= b.length; i++) v0[i] = i;
  for (let i = 0; i < a.length; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let j = 0; j <= b.length; j++) v0[j] = v1[j];
  }
  return v0[b.length] ?? Math.max(a.length, b.length);
}

// Jaccard 2-gram 類似度 — 0 (完全に違う) ~ 1 (完全一致)
function jaccard2gram(a: string, b: string): number {
  const A = new Set(ngrams(a, 2));
  const B = new Set(ngrams(b, 2));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

// 統合スコア (0..1)
//   - 完全一致: 1.0
//   - 一方が他方を包含: 0.9 補正
//   - jaccard 2gram スコア + (1 - normalize-levenshtein)
export function similarityScore(query: string, target: string): number {
  const a = deepNormalize(query);
  const b = deepNormalize(target);
  if (!a || !b) return 0;
  if (a === b) return 1;
  // 包含: 短い方が長い方に丸ごと含まれる
  if (a.length >= 3 && b.length >= 3) {
    if (b.includes(a) || a.includes(b)) {
      return 0.9;
    }
  }
  const jac = jaccard2gram(a, b);
  const lev = levenshtein(a, b);
  const levSim = 1 - lev / Math.max(a.length, b.length);
  // 重み: jaccard 0.6, lev 0.4 — 短い文字列で lev が暴れがちなので jaccard を重く
  return Math.max(0, Math.min(1, jac * 0.6 + levSim * 0.4));
}

export function isSimilar(query: string, target: string, threshold = SIM_THRESHOLD): boolean {
  return similarityScore(query, target) >= threshold;
}

// 候補一覧から閾値以上をスコア付きで返す
export function findSimilar<T extends { name: string }>(
  query: string,
  candidates: T[],
  opts: { threshold?: number; limit?: number } = {},
): { item: T; score: number }[] {
  const threshold = opts.threshold ?? SIM_THRESHOLD;
  const limit = opts.limit ?? 5;
  const out: { item: T; score: number }[] = [];
  for (const c of candidates) {
    const s = similarityScore(query, c.name);
    if (s >= threshold) out.push({ item: c, score: s });
  }
  out.sort((x, y) => y.score - x.score);
  return out.slice(0, limit);
}
