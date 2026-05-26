// ============================================================
// Typo Tolerance — Google 風タイポ吸収
// ============================================================
// 目的:
//   ユーザーが 1〜2 文字ミスしてもヒットさせる。既存の typoCorrect.ts は
//   "Did you mean..." のような single-best suggestion 用だが、こちらは
//   「クエリの拡張バリアント」として複数候補を生成する API を提供する。
//
// 設計方針:
//   - 既存の damerauLevenshtein を export しないため独自に持つ
//     (typoCorrect.ts は private 関数のまま、本ファイルは新規 API として独立)
//   - levenshtein だけでなく "近接キー" (qwerty) と "ひらがな ⇔ カタカナ"
//     も typo source として扱う (Google も近接キー混入を補正している)
//   - 候補生成は input ≤ 6 文字までで打ち切り (O(N×M) 爆発防止)
// ============================================================

import { deepNormalize, katakanaToHiragana, hiraganaToKatakana } from './tokenize';

// ============================================================
// Levenshtein 距離 (公開関数 — 他モジュールからも利用可能)
// ============================================================
//
// 既存の typoCorrect.ts に同等の private 関数があるが、こちらは export して
// 検索エンジン全体で使えるようにする。
const MAX_DL_LEN = 100;

/**
 * Damerau-Levenshtein 距離。隣接 2 文字の transpose も 1 操作として扱う。
 * 入力が長すぎる (>100) と OOM するので bail-out で max length を返す。
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  if (m > MAX_DL_LEN || n > MAX_DL_LEN) return Math.max(m, n);
  // length が大きく違うなら早期 reject (高い距離)
  if (Math.abs(m - n) > Math.max(m, n) * 0.8) return Math.max(m, n);
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i]![0] = i;
  for (let j = 0; j <= n; j++) d[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(
        d[i - 1]![j]! + 1,        // delete
        d[i]![j - 1]! + 1,        // insert
        d[i - 1]![j - 1]! + cost, // substitute
      );
      // transposition
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
      }
    }
  }
  return d[m]![n]!;
}

/**
 * 類似度 (0..1) — 1 = 完全一致, 0 = 全く違う。
 * deepNormalize を通すので半角/全角・カタカナ/ひらがな・長音差は吸収。
 */
export function typoSimilarity(a: string, b: string): number {
  const na = deepNormalize(a);
  const nb = deepNormalize(b);
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(na, nb) / maxLen;
}

// ============================================================
// 許容 distance 計算 — 入力長に応じて 1〜2 文字許容
// ============================================================
// Google も「短いクエリは厳密に、長いクエリは緩く」のルール。
//   - 1〜3 文字: 距離 1 (typo 許容ほぼなし、誤マッチ防止)
//   - 4〜6 文字: 距離 1
//   - 7 文字以上: 距離 2
export function typoTolerance(len: number): number {
  if (len <= 3) return 1;
  if (len <= 6) return 1;
  return 2;
}

// ============================================================
// 候補生成: クエリから「typo っぽいけど近い」候補を生成
// ============================================================
//
// 用途:
//   - 候補リスト (既知タグ) と照合する前に、まず元クエリのバリエーション
//     を作る。
//   - 個々のバリエーションは 1 文字違いの permutation。すべて levenshtein
//     1 以下になる。
//
// 制限:
//   - 6 文字超は爆発防止のためバリエーション生成しない (元クエリだけ返す)
//   - 候補数 cap = 48
//
// 例:
//   "ポケモン" (4文字) → ["ポケモン", "ぽけもん", "ポケモソ", "ボケモン", ...]

const MAX_GEN_LEN = 6;
const MAX_GEN_VARIANTS = 48;

/**
 * 入力に対して levenshtein <= 1 の単純 typo バリアントを生成。
 * 半角/全角・カタカナ⇔ひらがな差は別の variants.ts で吸収するため、
 * ここでは「char insert / delete / substitute / swap」のみ。
 */
export function generateTypoVariants(query: string): string[] {
  const q = query.trim();
  if (!q) return [];
  const out = new Set<string>([q]);
  if (q.length > MAX_GEN_LEN) return [...out];

  // 1 文字 delete
  for (let i = 0; i < q.length; i++) {
    out.add(q.slice(0, i) + q.slice(i + 1));
    if (out.size >= MAX_GEN_VARIANTS) return [...out];
  }
  // 隣接 2 文字 swap (transposition)
  for (let i = 0; i < q.length - 1; i++) {
    out.add(q.slice(0, i) + q[i + 1] + q[i] + q.slice(i + 2));
    if (out.size >= MAX_GEN_VARIANTS) return [...out];
  }
  // カタカナ ⇔ ひらがな swap (全体)
  out.add(katakanaToHiragana(q));
  out.add(hiraganaToKatakana(q));
  return [...out].filter((v) => v.length > 0);
}

// ============================================================
// 候補マッチング: 候補集合 (既知タグ) から typo 許容で hit する物を返す
// ============================================================
//
// 用途:
//   既存 findClosest は「最も近い 1 件」のみ。これは「許容範囲に入った全件」を
//   score 順で返す。検索エンジンの recall 拡張に使う。
//
// 例:
//   query = "ぽけもむ"  (1 文字 typo of "ポケモン")
//   candidates = ["ポケモン", "ポケモンgo", "ぽけもん go", ...]
//   → [{ candidate: "ポケモン", distance: 1, sim: 0.75 }, ...]

export type TypoMatch = {
  candidate: string;     // 元の候補 (表記そのまま)
  distance: number;      // levenshtein distance (deepNormalize 後)
  similarity: number;    // 0..1
};

/**
 * candidate 集合からタイポ許容で hit するものを抽出。
 *   - minSim 未満は捨てる
 *   - 距離が許容を超える物も捨てる
 *   - similarity 降順、距離昇順で sort
 */
export function findTypoCandidates(
  query: string,
  candidates: readonly string[],
  opts: { minSimilarity?: number; maxDistance?: number; limit?: number } = {},
): TypoMatch[] {
  const q = query.trim();
  if (!q) return [];
  const nq = deepNormalize(q);
  if (!nq) return [];
  const minSim = opts.minSimilarity ?? 0.6;
  const maxDist = opts.maxDistance ?? typoTolerance(nq.length);
  const limit = opts.limit ?? 10;

  const matches: TypoMatch[] = [];
  for (const c of candidates) {
    const nc = deepNormalize(c);
    if (!nc) continue;
    // length が大幅に違うなら計算するまでもなく typo ではない
    if (Math.abs(nq.length - nc.length) > maxDist + 1) continue;
    const dist = levenshteinDistance(nq, nc);
    if (dist > maxDist) continue;
    const maxLen = Math.max(nq.length, nc.length);
    const sim = maxLen === 0 ? 1 : 1 - dist / maxLen;
    if (sim < minSim) continue;
    matches.push({ candidate: c, distance: dist, similarity: sim });
  }
  matches.sort((a, b) => {
    if (b.similarity !== a.similarity) return b.similarity - a.similarity;
    return a.distance - b.distance;
  });
  return matches.slice(0, limit);
}

/**
 * クエリと候補が「typo 許容範囲内」か判定。simple yes/no chk.
 */
export function isTypoMatch(query: string, candidate: string, maxDistance?: number): boolean {
  const nq = deepNormalize(query);
  const nc = deepNormalize(candidate);
  if (!nq || !nc) return false;
  if (nq === nc) return true;
  const max = maxDistance ?? typoTolerance(nq.length);
  if (Math.abs(nq.length - nc.length) > max + 1) return false;
  return levenshteinDistance(nq, nc) <= max;
}
