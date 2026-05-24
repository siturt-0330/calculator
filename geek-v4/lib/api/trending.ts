// ============================================================
// lib/api/trending.ts — Trending タグ算出 (supabase fetch layer)
// ============================================================
// Phase 3 改修:
//   - **多時間軸** (1h / 6h / 24h) を選べる
//   - **改良 spike**: 最低 recent + ratio + window 別感度 で false positive 抑制
//   - **diversity**: Phase 2 relations primitive で 1 cluster = 1 代表
//   - 既存 API (fetchTrendingTags(limit: number)) は backward-compat 維持
//
// pure logic は trendingLogic.ts に切り出してあり、ここは supabase fetch 部分のみ。
// ============================================================

import { supabase } from '../supabase';
import {
  computeTrending,
  applyTrendingDiversity,
  isGossipBlocked,
  WINDOW_SPEC,
  type TimeWindow,
  type TrendingTag,
  type TagCounts,
} from './trendingLogic';
import type { CooccurMap } from '../tagClustering/suggest';

// public types (re-export)
export type { TimeWindow, TrendingTag } from './trendingLogic';

export type FetchTrendingOptions = {
  window?: TimeWindow;        // default '24h'
  limit?: number;             // default 8
  diversify?: boolean;        // default false (UI 側で opt-in)
  cooccur?: CooccurMap;       // diversify=true のとき必須
};

// posts table から fetch する件数 — 大きい window でも 500 posts に収まる想定
// 24h で 500 件 = 1 件 / 約 3 分。多すぎる場合は limit を上げる。
const POSTS_LIMIT_FOR_FETCH = 500;

// ============================================================
// public API (backward-compat の overload)
// ============================================================
//
// 旧呼び出し:  fetchTrendingTags(10)
// 新呼び出し:  fetchTrendingTags({ window: '6h', limit: 10, diversify: true, cooccur })
// ============================================================
export async function fetchTrendingTags(
  optsOrLimit: FetchTrendingOptions | number = {},
): Promise<TrendingTag[]> {
  const opts: FetchTrendingOptions = typeof optsOrLimit === 'number'
    ? { limit: optsOrLimit }
    : optsOrLimit;
  const limit = opts.limit ?? 8;
  const window = opts.window ?? '24h';
  const spec = WINDOW_SPEC[window];

  const now = Date.now();
  const since = new Date(now - spec.totalMs).toISOString();
  const splitAt = now - spec.splitMs;

  const { data, error } = await supabase
    .from('posts')
    .select('tag_names, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(POSTS_LIMIT_FOR_FETCH);
  if (error) return [];

  // タグ別の集計 (recent / prev / oldest / newest)
  const counts: Record<string, TagCounts> = {};
  for (const row of (data ?? []) as Array<{ tag_names: string[]; created_at: string }>) {
    const ts = new Date(row.created_at).getTime();
    for (const tag of row.tag_names ?? []) {
      if (isGossipBlocked(tag)) continue;
      const cur = counts[tag] ?? { recent: 0, prev: 0, oldest: ts, newest: ts };
      if (ts >= splitAt) cur.recent += 1;
      else cur.prev += 1;
      if (ts < cur.oldest) cur.oldest = ts;
      if (ts > cur.newest) cur.newest = ts;
      counts[tag] = cur;
    }
  }

  // 候補を絞る (上位 limit*4 まで)
  const candidateTags = Object.keys(counts)
    .sort((a, b) => (counts[b]!.recent + counts[b]!.prev) - (counts[a]!.recent + counts[a]!.prev))
    .slice(0, limit * 4);

  // tags table から全期間 post_count を引いてくる (UI で「累計人気」を見せる用)
  let totalsMap: Record<string, number> = {};
  if (candidateTags.length > 0) {
    const { data: tagRows } = await supabase
      .from('tags')
      .select('name, post_count')
      .in('name', candidateTags);
    for (const t of (tagRows ?? []) as Array<{ name: string; post_count: number }>) {
      totalsMap[t.name] = t.post_count;
    }
  }

  // pure helper に委譲 (candidateTags の subset の counts を渡す)
  const filteredCounts: Record<string, TagCounts> = {};
  for (const name of candidateTags) filteredCounts[name] = counts[name]!;
  let sorted = computeTrending(filteredCounts, totalsMap, window);

  // diversity: 強く関連するタグ (cooccur 高) を 1 cluster = 1 代表 に絞る
  if (opts.diversify && opts.cooccur) {
    sorted = applyTrendingDiversity(sorted, opts.cooccur, limit);
  }

  return sorted.slice(0, limit);
}

// ============================================================
// 複数 window をまとめて返す helper
// ============================================================
//
// 例: useTrendingDashboard などで「1h ホット」「6h ホット」「24h ホット」 を
// 横並びに表示する用途を想定。
// 内部で並列 fetch — 3 個の同時クエリを Promise.all。
// ============================================================
export async function fetchTrendingByAllWindows(
  opts: Omit<FetchTrendingOptions, 'window'> = {},
): Promise<Record<TimeWindow, TrendingTag[]>> {
  const limit = opts.limit ?? 8;
  const [w1h, w6h, w24h] = await Promise.all([
    fetchTrendingTags({ ...opts, window: '1h', limit }),
    fetchTrendingTags({ ...opts, window: '6h', limit }),
    fetchTrendingTags({ ...opts, window: '24h', limit }),
  ]);
  return { '1h': w1h, '6h': w6h, '24h': w24h };
}
