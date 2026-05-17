import { supabase } from '@/lib/supabase';

export type TrendingTag = {
  name: string;
  postCount: number;     // 24h以内の投稿件数
  totalPosts: number;    // 全期間
  velocity: number;      // 投稿/時間 (直近の勢い)
};

// 直近24時間で盛り上がっているタグを返す
export async function fetchTrendingTags(limit = 8): Promise<TrendingTag[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('posts')
    .select('tag_names, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) return [];

  // タグ別の集計
  const counts: Record<string, { c: number; oldest: number; newest: number }> = {};
  for (const row of (data ?? []) as Array<{ tag_names: string[]; created_at: string }>) {
    const ts = new Date(row.created_at).getTime();
    for (const tag of row.tag_names ?? []) {
      const cur = counts[tag] ?? { c: 0, oldest: ts, newest: ts };
      cur.c += 1;
      if (ts < cur.oldest) cur.oldest = ts;
      if (ts > cur.newest) cur.newest = ts;
      counts[tag] = cur;
    }
  }

  // 各タグの全期間ポスト数も取得 (上位候補のみ)
  const candidateTags = Object.keys(counts).sort((a, b) => counts[b]!.c - counts[a]!.c).slice(0, limit * 3);
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

  // ベロシティ計算: 投稿件数 / 時間窓 (1時間)
  const result: TrendingTag[] = candidateTags.map((name) => {
    const info = counts[name]!;
    const spanH = Math.max(1, (info.newest - info.oldest) / (1000 * 60 * 60));
    return {
      name,
      postCount: info.c,
      totalPosts: totalsMap[name] ?? info.c,
      velocity: info.c / spanH,
    };
  });

  // 投稿数で並べて返す (上位 limit 件)
  return result.sort((a, b) => b.postCount - a.postCount).slice(0, limit);
}
