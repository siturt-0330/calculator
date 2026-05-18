// 個人化されたフィードランキング (クライアントサイド)
// シグナル:
//   - liked タグへのアフィニティ
//   - 直近の検索クエリとのテキスト一致度
//   - 信頼スコア (低信頼を後退)
//   - 投稿の鮮度 (recency decay)
//   - 反応量 (likes + comments + reactions)
//   - 投稿種別の好みプロファイル

import type { Post } from '@/types/models';

export type RankingContext = {
  likedTags: Set<string>;
  blockedTags: Set<string>;
  tagAffinity: Record<string, number>;  // tag → 使われた回数
  recentTags: string[];                 // 直近見たタグ
  recentQueries: string[];
};

const HALF_LIFE_HOURS = 24;  // 24時間で半減

function recencyDecay(createdAt: string): number {
  const hours = (Date.now() - new Date(createdAt).getTime()) / 3_600_000;
  if (hours < 0) return 1;
  return Math.pow(0.5, hours / HALF_LIFE_HOURS);
}

function engagementScore(p: Post): number {
  const likes = p.likes_count ?? 0;
  const comments = p.comments_count ?? 0;
  const concerns = p.concern_count ?? 0;
  // 反応量を対数で正規化 + コメントは重み 2x
  const positive = Math.log(1 + likes) + 2 * Math.log(1 + comments);
  const negative = Math.log(1 + concerns) * 1.2;
  return Math.max(0, positive - negative);
}

export function smartScore(p: Post, ctx: RankingContext): number {
  const tags = p.tag_names ?? [];
  if (tags.some((t) => ctx.blockedTags.has(t))) return -Infinity;

  // タグアフィニティ
  let affinity = 0;
  for (const t of tags) {
    if (ctx.likedTags.has(t)) affinity += 1.5;
    affinity += (ctx.tagAffinity[t] ?? 0) * 0.1;
    if (ctx.recentTags.includes(t)) affinity += 0.5;
  }

  // 信頼スコア (低信頼を後退)
  const trust = (p.trust_score_at_post ?? 50) / 100;

  // 鮮度
  const decay = recencyDecay(p.created_at);

  // エンゲージメント
  const eng = engagementScore(p);

  // 重み付き合算
  const score = (
    1.0 * affinity +
    1.5 * decay +
    0.7 * eng +
    0.4 * trust
  );
  return score;
}

export function smartSort(posts: Post[], ctx: RankingContext): Post[] {
  return posts
    .map((p) => ({ p, s: smartScore(p, ctx) }))
    .filter((r) => r.s > -Infinity)
    .sort((a, b) => b.s - a.s)
    .map((r) => r.p);
}
