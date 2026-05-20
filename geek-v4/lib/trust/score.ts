// 信用スコア — 完全に透明な計算
// プロフィールの 5 つの signal から純粋関数でスコアを導出する。
// DB に新しいトリガーや列を足さず、profile 行だけで動く。

export type TrustTier = {
  key: 'rookie' | 'regular' | 'trusted' | 'veteran' | 'legend';
  name: string;
  emoji: string;
  min: number;
  max: number;
  color: string;
  perks: string[];
};

export const TIERS: TrustTier[] = [
  {
    key: 'rookie',
    name: '新人',
    emoji: '🌱',
    min: 0,
    max: 29,
    color: '#94a3b8',
    perks: [
      'コミュニティに参加できる',
      '投稿・コメントできる',
    ],
  },
  {
    key: 'regular',
    name: '常連',
    emoji: '💎',
    min: 30,
    max: 49,
    color: '#60a5fa',
    perks: [
      'プロフィールに 💎 バッジが付く',
      '毎日の継続でスコアが伸びる',
    ],
  },
  {
    key: 'trusted',
    name: '信頼',
    emoji: '⭐',
    min: 50,
    max: 69,
    color: '#34d399',
    perks: [
      'フィードで投稿が優先表示',
      '信頼バッジでアンカー回答者に',
      'コミュニティ作成上限 ↑',
    ],
  },
  {
    key: 'veteran',
    name: '古参',
    emoji: '🔥',
    min: 70,
    max: 84,
    color: '#f59e0b',
    perks: [
      '古参バッジでベテラン認定',
      '投稿に独自タグ作成可',
      'コメントが目立つ表示',
    ],
  },
  {
    key: 'legend',
    name: '伝説',
    emoji: '👑',
    min: 85,
    max: 100,
    color: '#a855f7',
    perks: [
      '月間ランキング掲載対象',
      '伝説バッジ＋プロフィール装飾',
      '全機能解放',
    ],
  },
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
      label: '通報',
      value: concernCount,
      contribution: Math.round(concernsPts * 10) / 10,
      cap: CAPS.concerns,
      hint: '報告を受けると -3pt／件（最大 -30pt）',
    },
  ];

  return { score, tier, nextTier, pointsToNext, components };
}
