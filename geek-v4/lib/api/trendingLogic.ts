// ============================================================
// lib/api/trendingLogic.ts — trending の pure helper
// ============================================================
// supabase 依存を切り離して unit test 可能にした薄い layer。
// trending.ts (実 fetch) は post fetch → counts 整形 → ここの関数に委譲。
// ============================================================

import { GOSSIP_TRENDING_BLOCKLIST_SET } from '../gossipBlocklist';
import { pairRelevance } from '../tagClustering/relations';
import type { CooccurMap } from '../tagClustering/suggest';

// ============================================================
// types
// ============================================================
export type TimeWindow = '1h' | '6h' | '24h';

export type TrendingTag = {
  name: string;
  postCount: number;          // 指定 window 内の投稿件数
  totalPosts: number;         // 全期間 (tags.post_count)
  velocity: number;           // 投稿/時間
  acceleration: number;       // 直近 - 前期間 の差
  isSpike: boolean;           // 突発バズ判定
  spikeMagnitude: number;     // recent / max(1, prev) の倍率
  window: TimeWindow;         // どの時間軸で計測されたか
};

export type TagCounts = {
  recent: number;
  prev: number;
  oldest: number;
  newest: number;
};

// ============================================================
// gossip filter
// ============================================================
// プロダクト方針: 「人が不幸になる」「事件」「スキャンダル」 系を無条件除外。
// ブロック設定の有無に関わらず trending には絶対に出さない。
export function isGossipBlocked(tag: string): boolean {
  if (GOSSIP_TRENDING_BLOCKLIST_SET.has(tag)) return true;
  const triggers = ['炎上', '逮捕', '訃報', '不倫', '浮気', '熱愛', 'スキャンダル', 'スクープ', '事件', '殺人', '死亡', '訴訟', '謝罪'];
  for (const trig of triggers) if (tag.includes(trig)) return true;
  return false;
}

// ============================================================
// constants
// ============================================================
// spike 判定の最小 recent count (window 別)
// 短い window ほど低い (1h で 2 件は spike 候補に乗せる)
export const MIN_RECENT_FOR_SPIKE: Record<TimeWindow, number> = {
  '1h':  2,
  '6h':  3,
  '24h': 5,
};
// recent / max(1, prev) 比率の閾値 — これ以上なら「突発」とみなす
export const SPIKE_RATIO = 2.5;

// 同 cluster とみなす関連性閾値 (pairRelevance 0..1 で)
// 0.55 ≒ cooccur count ~8 相当 (tanh(8/12) = 0.58)
export const DIVERSITY_THRESHOLD = 0.55;

// ============================================================
// window 別の時間境界
// ============================================================
// 「最近 N 時間」 vs 「その前 N 時間」 で比較する。
// 24h: 最近 12h vs 前 12h
// 6h:  最近 3h  vs 前 3h
// 1h:  最近 30m vs 前 30m
export type WindowSpec = {
  totalMs: number;     // window 全体
  splitMs: number;     // 「最近」と「前」を分ける境界
};
export const WINDOW_SPEC: Record<TimeWindow, WindowSpec> = {
  '1h':  { totalMs: 60 * 60 * 1000,                splitMs: 30 * 60 * 1000 },
  '6h':  { totalMs: 6  * 60 * 60 * 1000,           splitMs: 3  * 60 * 60 * 1000 },
  '24h': { totalMs: 24 * 60 * 60 * 1000,           splitMs: 12 * 60 * 60 * 1000 },
};

// ============================================================
// pure: counts → TrendingTag[] (sorted)
// ============================================================
//
// spike 判定 (改良版):
//   旧: prev=0 で recent>=5 か recent >= prev*3
//   新: 以下のすべてを満たす
//     - recent >= MIN_RECENT (window 別) — 単発投稿で spike しない
//     - recent / max(1, prev) >= SPIKE_RATIO (2.5)
//     - window が小さいほど MIN_RECENT を下げて感度上げる
//
// false positive 抑制: 新規タグが 1 投稿だけで spike 認定されることを防ぐ
export function computeTrending(
  counts: Record<string, TagCounts>,
  totals: Record<string, number>,
  window: TimeWindow,
): TrendingTag[] {
  const minRecent = MIN_RECENT_FOR_SPIKE[window];
  const out: TrendingTag[] = [];
  for (const [name, info] of Object.entries(counts)) {
    const postCount = info.recent + info.prev;
    const spanH = Math.max(0.25, (info.newest - info.oldest) / (1000 * 60 * 60));
    const velocity = postCount / spanH;
    const acceleration = info.recent - info.prev;
    const ratio = info.recent / Math.max(1, info.prev);
    const isSpike = info.recent >= minRecent && ratio >= SPIKE_RATIO;
    out.push({
      name,
      postCount,
      totalPosts: totals[name] ?? postCount,
      velocity,
      acceleration,
      isSpike,
      spikeMagnitude: ratio,
      window,
    });
  }
  // ranking: spike > acceleration > postCount
  out.sort((a, b) => {
    if (a.isSpike !== b.isSpike) return a.isSpike ? -1 : 1;
    if (a.acceleration !== b.acceleration) return b.acceleration - a.acceleration;
    return b.postCount - a.postCount;
  });
  return out;
}

// ============================================================
// pure: cluster 単位の代表化 (1 cluster 1 代表)
// ============================================================
//
// 例: 「乃木坂46 / 日向坂46 / 櫻坂46」が同時に spike → 上位 1 つだけ採用
// 閾値: pairRelevance(a, b) >= DIVERSITY_THRESHOLD なら同 cluster とみなす
//
// 入力 sorted は spike/acceleration/count で既に DESC されている前提。
// 上から順に「既 pick の代表と関連 < 閾値」 なものを採用していく greedy。
export function applyTrendingDiversity(
  sorted: TrendingTag[],
  cooccur: CooccurMap,
  limit: number,
): TrendingTag[] {
  if (sorted.length <= limit) return sorted;
  const picked: TrendingTag[] = [];
  for (const t of sorted) {
    let skip = false;
    for (const p of picked) {
      if (pairRelevance(t.name, p.name, cooccur) >= DIVERSITY_THRESHOLD) {
        skip = true;
        break;
      }
    }
    if (!skip) picked.push(t);
    if (picked.length >= limit) break;
  }
  return picked;
}
