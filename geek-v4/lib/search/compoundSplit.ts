// ============================================================
// 複合語スプリッター (Japanese has no spaces)
// ============================================================
// "ポケモンアニメ" を ["ポケモン", "アニメ"] に分解する。
// MeCab / Sudachi のような形態素解析ではなく、
// 「既知タグ辞書」を使った simple greedy split。
//
// アルゴリズム:
//   1. 入力文字列の各位置で分割点を試す
//   2. 左右の半分が既知タグ (or その prefix) と一致すれば候補に
//   3. 最大マッチ長 + 半分の長さの balance でスコアリング
//   4. 上位 K 個の分割候補を返す
// ============================================================

import { normalize } from './tokenize';

export type Split = {
  parts: string[];
  score: number;
};

// 既知タグセットから、再帰的に最適分割を返す
// (DP で memoization して O(N^2) で計算)
export function splitCompound(query: string, knownTags: Set<string>, opts: { maxParts?: number; minPartLen?: number } = {}): Split[] {
  const maxParts = opts.maxParts ?? 3;
  const minLen = opts.minPartLen ?? 2;
  const s = query.trim();
  if (s.length < minLen * 2) return [];

  const normalized = normalize(s);
  const normalKnown = new Set([...knownTags].map(normalize));
  // prefix-only knowledge: 前方一致するタグの prefix を集める
  const prefixSet = new Set<string>();
  for (const t of normalKnown) {
    for (let i = minLen; i <= t.length; i++) prefixSet.add(t.slice(0, i));
  }

  type Memo = { score: number; partsList: string[][] };
  const memo: Map<string, Memo> = new Map();

  // s[start..] を分割し、最良スコアと全候補を返す
  function go(start: number, depth: number): Memo {
    if (start === normalized.length) return { score: 0, partsList: [[]] };
    if (depth >= maxParts) return { score: -Infinity, partsList: [] };
    const key = `${start}:${depth}`;
    const cached = memo.get(key);
    if (cached) return cached;

    let best: Memo = { score: -Infinity, partsList: [] };
    for (let end = Math.min(normalized.length, start + 30); end >= start + minLen; end--) {
      const part = normalized.slice(start, end);
      let partScore = 0;
      if (normalKnown.has(part)) partScore = 100 + part.length * 5;
      else if (prefixSet.has(part)) partScore = 30 + part.length * 2;
      else partScore = -10;  // 未知部分はペナルティ

      const rest = go(end, depth + 1);
      if (rest.partsList.length === 0) continue;
      const combinedScore = partScore + rest.score;

      if (combinedScore > best.score) {
        const partsList = rest.partsList.map((pl) => [part, ...pl]);
        best = { score: combinedScore, partsList };
      } else if (combinedScore === best.score && best.partsList.length < 5) {
        const partsList = rest.partsList.map((pl) => [part, ...pl]);
        best.partsList.push(...partsList);
      }
    }

    memo.set(key, best);
    return best;
  }

  const result = go(0, 0);
  if (result.partsList.length === 0 || result.score <= 0) return [];

  // 最終フィルタ: 全パートが既知 (or prefix) のものだけ
  return result.partsList
    .filter((parts) => parts.every((p) => normalKnown.has(p) || prefixSet.has(p)))
    .map((parts) => ({ parts, score: result.score }))
    .slice(0, 5);
}

// シンプル版: 2-way 分割だけ試す (高速)
export function trySplit2Way(query: string, knownTags: Set<string>): string[] | null {
  const n = normalize(query);
  if (n.length < 4) return null;
  const tagSet = new Set([...knownTags].map(normalize));
  // 長い順から試して、両側がヒットしたものを採用
  for (let i = n.length - 2; i >= 2; i--) {
    const left = n.slice(0, i);
    const right = n.slice(i);
    if (tagSet.has(left) && tagSet.has(right)) return [left, right];
  }
  // どちらか1つだけ完全一致 + もう片方が prefix もある場合
  for (let i = n.length - 2; i >= 2; i--) {
    const left = n.slice(0, i);
    const right = n.slice(i);
    const leftHit = tagSet.has(left) || [...tagSet].some((t) => t.startsWith(left) && t.length >= left.length + 1);
    const rightHit = tagSet.has(right) || [...tagSet].some((t) => t.startsWith(right) && t.length >= right.length + 1);
    if (leftHit && rightHit) return [left, right];
  }
  return null;
}
