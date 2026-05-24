// ============================================================
// tagClustering/relations.ts — クラスタ信号の cross-algo primitive
// ============================================================
// 概要:
//   タグの「関連タグ」を取得する単一の入口。
//   Feed のスコアリング、Search のクエリ拡張、Trending のグルーピング
//   など複数アルゴリズムから呼ぶ。
//
//   入力: 1 個 (または複数) のタグ + cooccur マトリクス
//   出力: { tag, score } のリスト (score 降順)
//
//   実装:
//     - cooccur のキーは raw 表記なので、入力タグも raw 表記でルックアップ
//       しつつ、自身との同一判定は deepNormalize で正規化して行う
//     - 上限 topK で切る (Feed の per-post 計算が O(N) になるのを防ぐ)
//     - 最低共起 minCount でノイズ除去
//
//   なぜ別ファイル？
//     - lib/search/tagVector.findRelatedTags は graph + n-gram + cooccur の
//       multi-signal で重い (per-query で 50+ ms)。Feed 用には軽量な
//       cooccur-only primitive が欲しい。
//     - clustering 系の純粋な「関連性」を 1 箇所で定義し、Phase 3/4 で
//       trending / search expansion にも使う。
// ============================================================

import { deepNormalize } from '../search/tokenize';
import type { CooccurMap } from './suggest';

export type RelatedTag = {
  tag: string;     // deepNormalize 済み
  score: number;   // = cooccur count (相互方向の max)
};

export type GetRelatedOptions = {
  topK?: number;      // 返却上限 (default 10)
  minCount?: number;  // 最低 cooccur count (default 2)
};

// ============================================================
// 1 タグ → 関連タグ
// ============================================================
//
// cooccur のキーは raw 表記なので、入力タグも先に normalize → cooccur 全 key を
// 走査して norm 一致のものから neighbors を集める。
// (cooccur が「乃木坂46」キー、入力が「のぎざか」でも variant が同一 norm なら拾う)
export function getRelatedTags(
  tag: string,
  cooccur: CooccurMap,
  opts: GetRelatedOptions = {},
): RelatedTag[] {
  const topK = opts.topK ?? 10;
  const minCount = opts.minCount ?? 2;
  const queryNorm = deepNormalize(tag);
  if (!queryNorm) return [];

  // 集計: neighbor (normalized) → max count
  // 同じ neighbor を複数の variant 経由で見ても重複しない (Math.max)
  const aggregated: Record<string, number> = {};
  for (const [keyRaw, neighbors] of Object.entries(cooccur)) {
    if (deepNormalize(keyRaw) !== queryNorm) continue;
    for (const [neighborRaw, count] of Object.entries(neighbors)) {
      if (count < minCount) continue;
      const nNorm = deepNormalize(neighborRaw);
      if (!nNorm || nNorm === queryNorm) continue;
      const prev = aggregated[nNorm] ?? 0;
      if (count > prev) aggregated[nNorm] = count;
    }
  }

  return Object.entries(aggregated)
    .sort(([, a], [, b]) => b - a)
    .slice(0, topK)
    .map(([t, s]) => ({ tag: t, score: s }));
}

// ============================================================
// 複数タグ → マージ済み関連タグ
// ============================================================
//
// 各入力タグから関連タグを集めて、normalized キーで merge。
// 同じ neighbor が複数の入力から出てきた場合は max score (or sum?) でマージ。
// 検索クエリ拡張用 → max を採用 (1 タグでも強く関連すれば残す)。
export function expandWithCooccur(
  inputTags: string[],
  cooccur: CooccurMap,
  opts: GetRelatedOptions = {},
): RelatedTag[] {
  const topK = opts.topK ?? 20;
  const perTagTopK = opts.topK ?? 10;
  const merged: Record<string, number> = {};
  // 入力タグ自身は結果から除外
  const inputNorm = new Set(inputTags.map(deepNormalize).filter(Boolean));
  for (const t of inputTags) {
    const related = getRelatedTags(t, cooccur, { topK: perTagTopK, minCount: opts.minCount });
    for (const r of related) {
      if (inputNorm.has(r.tag)) continue;
      const prev = merged[r.tag] ?? 0;
      if (r.score > prev) merged[r.tag] = r.score;
    }
  }
  return Object.entries(merged)
    .sort(([, a], [, b]) => b - a)
    .slice(0, topK)
    .map(([t, s]) => ({ tag: t, score: s }));
}

// ============================================================
// 2 タグの関連スコア (片方を起点に、もう片方が共起にあるかチェック)
// ============================================================
//
// Feed の post-vs-interest 関係性チェックなどで使用。
// 戻り値 0..1: cooccur count を tanh で 0..1 に圧縮。
// 0 = 関連無し、0.5 = 中程度 (count ~12)、1.0 = 非常に強い (count >> 20)
export function pairRelevance(
  a: string,
  b: string,
  cooccur: CooccurMap,
): number {
  const aNorm = deepNormalize(a);
  const bNorm = deepNormalize(b);
  if (!aNorm || !bNorm || aNorm === bNorm) return 0;
  let best = 0;
  for (const [keyRaw, neighbors] of Object.entries(cooccur)) {
    if (deepNormalize(keyRaw) !== aNorm) continue;
    for (const [neighborRaw, count] of Object.entries(neighbors)) {
      if (deepNormalize(neighborRaw) === bNorm && count > best) best = count;
    }
  }
  // a → b と b → a の両方向で max
  for (const [keyRaw, neighbors] of Object.entries(cooccur)) {
    if (deepNormalize(keyRaw) !== bNorm) continue;
    for (const [neighborRaw, count] of Object.entries(neighbors)) {
      if (deepNormalize(neighborRaw) === aNorm && count > best) best = count;
    }
  }
  if (best === 0) return 0;
  // 圧縮: count 12 で 0.5, count 24 で 0.76 程度
  return Math.tanh(best / 12);
}
