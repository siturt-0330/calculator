// ============================================================
// Personalization — feed ranking
// ============================================================
// Pure functions: 候補リスト + プロファイル + context → スコア付き候補。
// マルチ目的: interest × quality × freshness × novelty × session × trending。
// diversity injection + 強制 exploration で filter bubble を抑制。
// ============================================================

import type { UserInterestProfile } from './profile';
import { deepNormalize } from '../search/tokenize';
import type { CooccurMap } from '../tagClustering/suggest';

// 候補のタグを profile キーと突き合わせる前に deepNormalize する。
// (events.logEvent でも同じ正規化を通しているので、両側が hiragana lowercase で揃う)
function normTags(tags: string[]): string[] {
  const out: string[] = [];
  for (const t of tags) {
    const n = deepNormalize(t);
    if (n.length > 0) out.push(n);
  }
  return out;
}

export type RankableCandidate = {
  id: string;
  tags: string[];
  category?: string;
  created_at: string;
  like_count: number;
  reply_count?: number;
  trust_score_at_post?: number | null;
  is_seen?: boolean;
};

export type RankReason = {
  text: string;
  kind:
    | 'interest_tag'
    | 'interest_category'
    | 'session'
    | 'trending'
    | 'exploration'
    | 'quality'
    | 'fresh'
    | 'cold_start';
};

export type ScoredCandidate = {
  id: string;
  score: number;
  reason: RankReason;
};

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------
function log1p(x: number): number {
  return Math.log(1 + Math.max(0, x));
}

function ageHours(created_at: string, now: number): number {
  const t = new Date(created_at).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, (now - t) / 3_600_000);
}

function freshness(c: RankableCandidate, now: number): number {
  const h = ageHours(c.created_at, now);
  return 30 * Math.exp(-h / 72);
}

function quality(c: RankableCandidate): number {
  const trust = c.trust_score_at_post ?? 50;
  return 0.3 * trust + 0.5 * log1p(c.like_count) + 0.3 * log1p(c.reply_count ?? 0);
}

function interestScore(c: RankableCandidate, profile: UserInterestProfile): number {
  const normed = normTags(c.tags);
  let tagSum = 0;
  for (const t of normed) tagSum += profile.tagAffinity[t] ?? 0;
  const tagNorm = tagSum / Math.sqrt(normed.length || 1);
  const cat = c.category ? profile.categoryAffinity[c.category] ?? 0 : 0;
  return tagNorm + 0.5 * cat;
}

function sessionBonus(c: RankableCandidate, profile: UserInterestProfile): number {
  if (profile.recentTags.length === 0) return 0;
  const recent = new Set(profile.recentTags);
  for (const t of normTags(c.tags)) if (recent.has(t)) return 20;
  return 0;
}

function trendingBonus(c: RankableCandidate, trending: Set<string>): number {
  if (trending.size === 0) return 0;
  // trendingTags は元の表記 (Vtuber 等) の場合があるので両表記でチェック
  for (const t of c.tags) if (trending.has(t)) return 10;
  for (const t of normTags(c.tags)) if (trending.has(t)) return 10;
  return 0;
}

// ============================================================
// relatedTagBonus — Phase 2 cross-algo signal
// ============================================================
//
// 投稿の tag のうち、ユーザーの興味タグと「共起 (cooccur) 関係にある」 ものを
// 検出し、小さな boost を与える。
//
// 目的: 「ユーザーが乃木坂46 を好きなら、欅坂46/日向坂46 が tag に付いてる
// 投稿も少しだけ上に来る」 — 完全には合致してないが、cluster 的に近い投稿
// を発見しやすくする。
//
// 設計:
//   - interestNorm: 既に正規化済みのユーザー興味タグ集合 (likedTags ∪ 高 affinity)
//   - cooccur: 全タグ間の共起マトリクス
//   - 投稿の各 tag に対し:
//       - cooccur[tag] の neighbors のうち、interest 集合に含まれるものを集計
//       - そのときの cooccur count に応じて bonus
//   - 直接マッチ (interestScore で既にカバー) のタグは除外して二重計上を防ぐ
//   - cap = 4 (interest/quality 等より小さく抑える — 過剰な誘導を防ぐ)
// ============================================================
function relatedTagBonus(
  c: RankableCandidate,
  cooccur: CooccurMap | undefined,
  interestNorm: ReadonlySet<string> | undefined,
): number {
  if (!cooccur || !interestNorm || interestNorm.size === 0) return 0;
  if (c.tags.length === 0) return 0;
  const postNorm = new Set(normTags(c.tags));
  let bonus = 0;
  for (const postTagRaw of c.tags) {
    const neighbors = cooccur[postTagRaw];
    if (!neighbors) continue;
    for (const [neighborRaw, count] of Object.entries(neighbors)) {
      if (count < 3) continue;
      const nNorm = deepNormalize(neighborRaw);
      if (!nNorm) continue;
      // 投稿自身に同じタグが付いていれば直接 interest match で既にカウント済み
      if (postNorm.has(nNorm)) continue;
      if (interestNorm.has(nNorm)) {
        // count 5 → 0.5, count 10 → 1.0 (cap)
        bonus += Math.min(count / 10, 1);
      }
    }
  }
  // 最大 4 で cap — interest/quality 等よりは控えめに
  return Math.min(bonus * 0.6, 4);
}

function topAffinityTag(
  c: RankableCandidate,
  profile: UserInterestProfile,
): { display: string; value: number } | null {
  // 表示用には元の表記 (Vtuber) を返したいので原典 / normed を並列で持つ
  const orig = c.tags;
  const normed = normTags(c.tags);
  let best: { display: string; value: number } | null = null;
  for (let i = 0; i < normed.length; i++) {
    const v = profile.tagAffinity[normed[i]!] ?? 0;
    if (best === null || v > best.value) {
      best = { display: orig[i] ?? normed[i] ?? '', value: v };
    }
  }
  return best;
}

function firstTrendingTag(c: RankableCandidate, trending: Set<string>): string | null {
  // 元の表記 / 正規化の両方でチェック (表示には元表記を返す)
  const orig = c.tags;
  const normed = normTags(c.tags);
  for (let i = 0; i < orig.length; i++) if (trending.has(orig[i]!)) return orig[i]!;
  for (let i = 0; i < normed.length; i++) {
    if (trending.has(normed[i]!)) return orig[i] ?? normed[i]!;
  }
  return null;
}

function firstRecentTag(c: RankableCandidate, profile: UserInterestProfile): string | null {
  // profile.recentTags は normalized なので両側で揃える。表示には元表記を返す。
  const recent = new Set(profile.recentTags);
  const orig = c.tags;
  const normed = normTags(c.tags);
  for (let i = 0; i < normed.length; i++) {
    if (recent.has(normed[i]!)) return orig[i] ?? normed[i]!;
  }
  return null;
}

// Cold-start formula: ignore interest, lean on freshness + quality + trending
function scoreCold(c: RankableCandidate, ctx: ScoreCtx): number {
  const fresh = freshness(c, ctx.now);
  const q = quality(c);
  const tr = trendingBonus(c, ctx.trendingTags);
  const seen = c.is_seen ? -25 : 0;
  return 2 * fresh + 1.5 * q + 2 * tr + seen;
}

type ScoreCtx = {
  now: number;
  trendingTags: Set<string>;
  explorationBudget: number;
  // Phase 2: cross-algo cluster signal (optional; rankFeed が無くても動く)
  cooccur?: CooccurMap | undefined;
  interestTagsNorm?: ReadonlySet<string> | undefined;
};

// ----------------------------------------------------------------
// Public: scoreCandidate
// ----------------------------------------------------------------
export function scoreCandidate(
  c: RankableCandidate,
  profile: UserInterestProfile,
  ctx: ScoreCtx,
): ScoredCandidate {
  // Cold-start branch
  if (profile.isColdStart) {
    const s = scoreCold(c, ctx);
    return {
      id: c.id,
      score: s,
      reason: { kind: 'cold_start', text: 'まずは人気のものから' },
    };
  }

  const interest = interestScore(c, profile);
  const session = sessionBonus(c, profile);
  const fresh = freshness(c, ctx.now);
  const q = quality(c);
  const novelty = c.is_seen ? -25 : 0;
  const trBonus = trendingBonus(c, ctx.trendingTags);
  // Phase 2: cluster cooccur boost — interest と「近い」タグに小さく加点
  const relatedBonus = relatedTagBonus(c, ctx.cooccur, ctx.interestTagsNorm);

  const score = interest + session + fresh + q + novelty + trBonus + relatedBonus;

  // ----------------------------------------------------------------
  // Reason selection (priority order)
  // ----------------------------------------------------------------
  let reason: RankReason;

  // 1) session
  if (session > 0) {
    const t = firstRecentTag(c, profile) ?? '';
    reason = { kind: 'session', text: `さっき見ていた #${t} の話題` };
  }
  // 2) interest tag dominates
  else if (
    (() => {
      const top = topAffinityTag(c, profile);
      return top !== null && top.value > 5;
    })()
  ) {
    const top = topAffinityTag(c, profile);
    reason = {
      kind: 'interest_tag',
      text: `#${top?.display ?? ''} に興味があるあなた向け`,
    };
  }
  // 3) category match dominates
  else if (
    c.category &&
    (profile.categoryAffinity[c.category] ?? 0) > 5
  ) {
    reason = {
      kind: 'interest_category',
      text: `${c.category} 板をよく見るあなた向け`,
    };
  }
  // 4) trending
  else if (trBonus > 0) {
    const t = firstTrendingTag(c, ctx.trendingTags) ?? '';
    reason = { kind: 'trending', text: `今 急上昇 #${t}` };
  }
  // 5) quality
  else if ((c.trust_score_at_post ?? 0) > 70 && c.like_count > 20) {
    reason = { kind: 'quality', text: '評価の高い投稿' };
  }
  // 6) freshness
  else if (fresh > 15) {
    reason = { kind: 'fresh', text: '新着' };
  }
  // fallback
  else {
    reason = { kind: 'fresh', text: '新着' };
  }

  return { id: c.id, score, reason };
}

// ----------------------------------------------------------------
// Diversity helper: dominant tag of a candidate (highest affinity tag,
// fallback to first tag — used purely for diversity bucketing)
// ----------------------------------------------------------------
function dominantTag(c: RankableCandidate, profile: UserInterestProfile): string | null {
  if (c.tags.length === 0) return null;
  const top = topAffinityTag(c, profile);
  if (top) return top.display;
  return c.tags[0] ?? null;
}

// ----------------------------------------------------------------
// Public: rankFeed
// ----------------------------------------------------------------
export function rankFeed(
  candidates: RankableCandidate[],
  profile: UserInterestProfile,
  ctx: {
    now: number;
    trendingTags: Set<string>;
    targetCount: number;
    // Phase 2: optional cooccur + interest set for cluster-aware boost
    cooccur?: CooccurMap | undefined;
    interestTagsNorm?: ReadonlySet<string> | undefined;
  },
): ScoredCandidate[] {
  const targetCount = Math.max(0, Math.floor(ctx.targetCount));
  if (targetCount === 0 || candidates.length === 0) return [];

  // exploration budget = ceil(targetCount / 8) — at least 1 if targetCount >= 1
  const explorationBudget = Math.max(1, Math.ceil(targetCount / 8));

  const scoreCtx: ScoreCtx = {
    now: ctx.now,
    trendingTags: ctx.trendingTags,
    explorationBudget,
    cooccur: ctx.cooccur,
    interestTagsNorm: ctx.interestTagsNorm,
  };

  // Score all
  const scored: ScoredCandidate[] = candidates.map((c) => scoreCandidate(c, profile, scoreCtx));
  const byId: Record<string, RankableCandidate> = {};
  for (const c of candidates) byId[c.id] = c;

  // Sort by score desc
  scored.sort((a, b) => b.score - a.score);

  // Take top 3 × targetCount as pool
  const pool = scored.slice(0, Math.max(targetCount * 3, targetCount));

  // ----------------------------------------------------------------
  // Diversity walk: max 3 from same dominant tag
  // ----------------------------------------------------------------
  const tagCount: Record<string, number> = {};
  const picked: ScoredCandidate[] = [];
  const pickedIds = new Set<string>();
  const overflow: ScoredCandidate[] = [];

  for (const s of pool) {
    if (picked.length >= targetCount) break;
    const c = byId[s.id];
    if (!c) continue;
    const dom = dominantTag(c, profile);
    const key = dom ?? '__none__';
    const cur = tagCount[key] ?? 0;
    if (cur >= 3) {
      overflow.push(s);
      continue;
    }
    picked.push(s);
    pickedIds.add(s.id);
    tagCount[key] = cur + 1;
  }

  // ----------------------------------------------------------------
  // Exploration injection: 1 per 8, from below-median affinity tags
  // Compute median tag affinity to define "below median".
  // ----------------------------------------------------------------
  if (!profile.isColdStart && explorationBudget > 0) {
    const affValues = Object.values(profile.tagAffinity).sort((a, b) => a - b);
    let median = 0;
    if (affValues.length > 0) {
      const mid = Math.floor(affValues.length / 2);
      median = affValues[mid] ?? 0;
    }

    // Candidates not yet picked, where ALL their tags have affinity <= median
    // (i.e. the user has NOT engaged with these tags much) — that's exploration.
    const explorationCandidates = scored.filter((s) => {
      if (pickedIds.has(s.id)) return false;
      const c = byId[s.id];
      if (!c) return false;
      if (c.tags.length === 0) return false;
      for (const t of c.tags) {
        const a = profile.tagAffinity[t] ?? 0;
        if (a > median) return false;
      }
      return true;
    });

    // Inject up to explorationBudget items at evenly-spaced positions
    let injected = 0;
    for (let slot = 7; slot < picked.length && injected < explorationBudget; slot += 8) {
      const expCand = explorationCandidates[injected];
      if (!expCand) break;
      const explored: ScoredCandidate = {
        id: expCand.id,
        score: expCand.score,
        reason: { kind: 'exploration', text: '新しいジャンルもチェック' },
      };
      // Replace the candidate at this slot (or insert if room)
      picked[slot] = explored;
      pickedIds.add(explored.id);
      injected += 1;
    }
  }

  // If diversity skipped too aggressively and we have room, top up from overflow
  if (picked.length < targetCount) {
    for (const s of overflow) {
      if (picked.length >= targetCount) break;
      if (pickedIds.has(s.id)) continue;
      picked.push(s);
      pickedIds.add(s.id);
    }
  }

  return picked.slice(0, targetCount);
}
