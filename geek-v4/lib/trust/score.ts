// 信用スコア — 完全に透明な計算
// プロフィールの 5 つの signal から純粋関数でスコアを導出する。
// DB に新しいトリガーや列を足さず、profile 行だけで動く。

// ============================================================
// 信頼ティアの境界 — 2026-05 改修
// ------------------------------------------------------------
// #96 (feat/trust-score-friendly-labels) の「肩書」(新参者 / 常連 / 多分良い人 /
// 絶対良い人 / 神) と emoji / perks は UI に一度も描画されないまま休眠コード化
// していたため撤去。表示は数値スコア (0-100) のみ (app/settings/trust-score.tsx)。
// tier は内部の境界判定 (key / min / max / color) としてのみ残す:
//   - 0-29 / 30-69 / 70-89 / 90-99 / 100 の 5 段階
//   - color は将来の内部利用 (バッジ色など) 用に保持
// ============================================================
export type TrustTier = {
  key: 'newcomer' | 'regular' | 'probably_nice' | 'definitely_nice' | 'god';
  min: number;
  max: number;
  color: string;
};

export const TIERS: TrustTier[] = [
  { key: 'newcomer', min: 0, max: 29, color: '#94a3b8' },
  { key: 'regular', min: 30, max: 69, color: '#60a5fa' },
  { key: 'probably_nice', min: 70, max: 89, color: '#34d399' },
  { key: 'definitely_nice', min: 90, max: 99, color: '#f59e0b' },
  { key: 'god', min: 100, max: 100, color: '#a855f7' },
];

export type TrustComponent = {
  key: 'base' | 'posts' | 'likes' | 'comments' | 'active_days' | 'concerns';
  label: string;
  value: number;
  contribution: number;
  cap: number;
  hint: string;
};

export type TrustBreakdown = {
  score: number;
  tier: TrustTier;
  nextTier: TrustTier | null;
  pointsToNext: number;
  components: TrustComponent[];
};

// profile 行から受け取る最小限の shape (DB の Profile 列に対応)
export type ProfileLike = {
  post_count: number | null;
  like_received_count: number | null;
  comment_count: number | null;
  concern_received_count: number | null;
  created_at: string | null;
};

const BASE_SCORE = 30;

const CAPS = {
  posts: 15,
  likes: 25,
  comments: 10,
  active_days: 12,
  concerns: 30,
} as const;

const RATES = {
  posts: 0.5,
  likes: 1.0,
  comments: 0.4,
  active_days: 0.3,
  concerns: 3,
} as const;

function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function safeCount(n: number | null | undefined): number {
  if (n == null || !Number.isFinite(n) || n < 0) return 0;
  return n;
}

function daysSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  const days = Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24));
  return days < 0 ? 0 : days;
}

export function tierForScore(score: number): TrustTier {
  const s = clamp(Math.round(score), 0, 100);
  for (const tier of TIERS) {
    if (s >= tier.min && s <= tier.max) return tier;
  }
  // 念のためのフォールバック (logic 上ここには来ない)
  const first = TIERS[0];
  if (!first) throw new Error('TIERS array is empty');
  return first;
}

export function computeTrustBreakdown(profile: ProfileLike): TrustBreakdown {
  const postCount = safeCount(profile.post_count);
  const likeCount = safeCount(profile.like_received_count);
  const commentCount = safeCount(profile.comment_count);
  const concernCount = safeCount(profile.concern_received_count);
  const days = daysSince(profile.created_at);

  const postsPts = Math.min(postCount * RATES.posts, CAPS.posts);
  const likesPts = Math.min(likeCount * RATES.likes, CAPS.likes);
  const commentsPts = Math.min(commentCount * RATES.comments, CAPS.comments);
  const daysPts = Math.min(days * RATES.active_days, CAPS.active_days);
  const concernsPts = -Math.min(concernCount * RATES.concerns, CAPS.concerns);

  const raw = BASE_SCORE + postsPts + likesPts + commentsPts + daysPts + concernsPts;
  const score = clamp(Math.round(raw), 0, 100);

  const tier = tierForScore(score);
  const tierIdx = TIERS.findIndex((t) => t.key === tier.key);
  const nextTier: TrustTier | null =
    tierIdx >= 0 && tierIdx < TIERS.length - 1 ? (TIERS[tierIdx + 1] ?? null) : null;
  const pointsToNext = nextTier ? Math.max(0, nextTier.min - score) : 0;

  const components: TrustComponent[] = [
    {
      key: 'base',
      label: '基礎スコア',
      value: 1,
      contribution: BASE_SCORE,
      cap: BASE_SCORE,
      hint: '全員に付与される基礎スコア',
    },
    {
      key: 'posts',
      label: '投稿',
      value: postCount,
      contribution: Math.round(postsPts * 10) / 10,
      cap: CAPS.posts,
      hint: '投稿するごとに +0.5pt（最大 15pt）',
    },
    {
      key: 'likes',
      label: 'もらった ♥',
      value: likeCount,
      contribution: Math.round(likesPts * 10) / 10,
      cap: CAPS.likes,
      hint: '♥ をもらうごとに +1.0pt（最大 25pt）',
    },
    {
      key: 'comments',
      label: 'コメント',
      value: commentCount,
      contribution: Math.round(commentsPts * 10) / 10,
      cap: CAPS.comments,
      hint: 'コメントするごとに +0.4pt（最大 10pt）',
    },
    {
      key: 'active_days',
      label: '継続日数',
      value: days,
      contribution: Math.round(daysPts * 10) / 10,
      cap: CAPS.active_days,
      hint: 'アカウントを長く使うほど伸びる（最大 12pt）',
    },
    {
      key: 'concerns',
      label: '気になる',
      value: concernCount,
      contribution: Math.round(concernsPts * 10) / 10,
      cap: CAPS.concerns,
      hint: '他のユーザーから「気になる」を受けると -3pt／件（最大 -30pt）',
    },
  ];

  return { score, tier, nextTier, pointsToNext, components };
}
