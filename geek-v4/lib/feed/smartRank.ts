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
  trendingTags?: Set<string>;           // 急上昇タグ (24h)
  ctrBoosts?: Record<string, number>;   // tag → CTR 加点
};

// ランキングモード。primary 軸の重みを変えつつ、blocked / liked / affinity は常に適用する。
export type RankingMode = 'hot' | 'new' | 'top';

type Weights = { affinity: number; decay: number; eng: number; trust: number };

const WEIGHTS: Record<RankingMode, Weights> = {
  // 既存のバランス重み (hot)
  hot: { affinity: 1.0, decay: 1.5, eng: 0.7, trust: 0.4 },
  // new: recency を 3x、engagement を 0.5x
  new: { affinity: 1.0, decay: 4.5, eng: 0.35, trust: 0.4 },
  // top: engagement を 3x、recency を 0.5x
  top: { affinity: 1.0, decay: 0.75, eng: 2.1, trust: 0.4 },
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

export function smartScore(p: Post, ctx: RankingContext, mode: RankingMode = 'hot'): number {
  const tags = p.tag_names ?? [];
  if (tags.some((t) => ctx.blockedTags.has(t))) return -Infinity;

  // タグアフィニティ
  let affinity = 0;
  for (const t of tags) {
    if (ctx.likedTags.has(t)) affinity += 1.5;
    affinity += (ctx.tagAffinity[t] ?? 0) * 0.1;
    if (ctx.recentTags.includes(t)) affinity += 0.5;
    // トレンドタグなら追加ブースト
    if (ctx.trendingTags instanceof Set && ctx.trendingTags.has(t)) affinity += 0.8;
    // CTR ブースト (過去にこのタグの投稿をよくクリック)
    const ctr = ctx.ctrBoosts?.[t] ?? 0;
    if (ctr > 0) affinity += Math.min(2, ctr * 0.3);
  }

  // 信頼スコア (低信頼を後退)
  const trust = (p.trust_score_at_post ?? 50) / 100;

  // 鮮度
  const decay = recencyDecay(p.created_at);

  // エンゲージメント
  const eng = engagementScore(p);

  // モード別の重み付き合算 (個人化シグナルは常に適用)
  const w = WEIGHTS[mode];
  const score = (
    w.affinity * affinity +
    w.decay * decay +
    w.eng * eng +
    w.trust * trust
  );
  return score;
}

export function smartSort(posts: Post[], ctx: RankingContext, mode: RankingMode = 'hot'): Post[] {
  return posts
    .map((p) => ({ p, s: smartScore(p, ctx, mode) }))
    .filter((r) => r.s > -Infinity)
    .sort((a, b) => b.s - a.s)
    .map((r) => r.p);
}
