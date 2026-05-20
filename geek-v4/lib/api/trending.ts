import { supabase } from '@/lib/supabase';

export type TrendingTag = {
  name: string;
  postCount: number;     // 24h以内の投稿件数
  totalPosts: number;    // 全期間
  velocity: number;      // 投稿/時間 (直近の勢い)
  acceleration: number;  // 加速度: 直近 12h - 前の 12h の差 (突発バズ検知)
  isSpike: boolean;      // 加速度 > 閾値 (= 突発的にホット)
};

// 直近24時間で盛り上がっているタグを返す + 加速度で spike 検知
export async function fetchTrendingTags(limit = 8): Promise<TrendingTag[]> {
  const now = Date.now();
  const since = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const splitAt = now - 12 * 60 * 60 * 1000;  // 12h 前を境に「最近」「前」で分ける

  const { data, error } = await supabase
    .from('posts')
    .select('tag_names, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) return [];

  // タグ別の集計 (recent = 直近 12h、prev = 12h - 24h)
  const counts: Record<string, { recent: number; prev: number; oldest: number; newest: number }> = {};
  for (const row of (data ?? []) as Array<{ tag_names: string[]; created_at: string }>) {
    const ts = new Date(row.created_at).getTime();
    for (const tag of row.tag_names ?? []) {
      const cur = counts[tag] ?? { recent: 0, prev: 0, oldest: ts, newest: ts };
      if (ts >= splitAt) cur.recent += 1;
      else cur.prev += 1;
      if (ts < cur.oldest) cur.oldest = ts;
      if (ts > cur.newest) cur.newest = ts;
      counts[tag] = cur;
    }
  }

  // 候補抽出 — 直近 + 前の合計
  const candidateTags = Object.keys(counts)
    .sort((a, b) => (counts[b]!.recent + counts[b]!.prev) - (counts[a]!.recent + counts[a]!.prev))
    .slice(0, limit * 3);

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

  // 集計
  const result: TrendingTag[] = candidateTags.map((name) => {
    const info = counts[name]!;
    const postCount = info.recent + info.prev;
    const spanH = Math.max(1, (info.newest - info.oldest) / (1000 * 60 * 60));
    // velocity: 投稿/時間
    const velocity = postCount / spanH;
    // acceleration: 直近 12h - 前の 12h
    // 例: prev=2 / recent=15 → accel = +13 = 突発バズ
    const acceleration = info.recent - info.prev;
    // isSpike: 直近が前の 3 倍以上 (prev=0 でも recent≥5 で spike 認定)
    const isSpike = (info.prev === 0 && info.recent >= 5) || info.recent >= info.prev * 3;
    return {
      name,
      postCount,
      totalPosts: totalsMap[name] ?? postCount,
      velocity,
      acceleration,
      isSpike,
    };
  });

  // ランキング: spike > 加速度 > postCount の順
  return result
    .sort((a, b) => {
      if (a.isSpike !== b.isSpike) return a.isSpike ? -1 : 1;
      if (a.acceleration !== b.acceleration) return b.acceleration - a.acceleration;
      return b.postCount - a.postCount;
    })
    .slice(0, limit);
}
