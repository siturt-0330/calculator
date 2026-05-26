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
import type { Post } from '../../types/models';

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

// ============================================================
// YouTube-style ranking (Phase 3)
// ------------------------------------------------------------
// computePostScore は「興味」「品質」「鮮度」「新規性」「探索」を 1 つの
// 重み付き合計に集約する pure 関数。rankFeed が候補プールに対して
// scoreCandidate を回すのと違い、こちらは Post 型をそのまま受け取って
// 単独の score を返すシンプルな contract。
//
// 重み (initial values):
//   - Tag Affinity (Jaccard × TF-IDF):  係数 18
//       自分が過去にいいねしたタグと候補タグの共通度。共通タグの IDF が
//       高い (= 全体では稀) ほど boost。Google PageRank の rare boost に
//       インスパイアされた挙動。
//   - Engagement (log scale):           係数 6
//       Hacker News 風 log(1 + likes) + log(1 + comments) + log(1 + concern boost)
//       — like を重く、comment は中程度、concern は少しマイナス。
//   - Time decay (HN style):            乗数 1 / (hours + 2) ** decayExp
//       engagement が多い post は decayExp を緩める (1.8 → 1.4)
//   - Fresh boost (1 時間以内):           +6
//   - Fresh-user exploration:            自分のアカウント年齢 < 7 日なら
//       小さなランダムノイズ (±2) を score に加算 — 探索促進
// ============================================================

export interface ScoreInput {
  post: Post;
  /** tag (normalized) → 自分がいいねした回数 */
  userLikedTagsFreq: Map<string, number>;
  /** tag (normalized) → 全体出現数 (TF-IDF の document frequency) */
  globalTagFreq: Map<string, number>;
  now: Date;
  /** 自分のアカウントの作成からの経過日数 (小数可) */
  myAccountAgeDays: number;
  /** 全体の post 総数 (IDF の分子 N — 未指定なら globalTagFreq の最大値で近似) */
  totalPosts?: number;
  /** noise を deterministic にしたい test 用に注入できる (default Math.random) */
  random?: () => number;
}

// ----------------------------------------------------------------
// Tag affinity helper — Jaccard × TF-IDF
// ----------------------------------------------------------------
// 投稿のタグ集合 P と「自分が過去にいいねしたタグ集合」 L の交差を取り、
// 各交差タグについて IDF 重み = log((N + 1) / (df + 1)) を計算して合計。
// 全体を |P ∪ L| で割って Jaccard 風に正規化する。
//
// IDF 強調: 全体で稀なタグ (df 小) ほど log((N+1)/(df+1)) が大きく、
// rare tag boost として効く。これが「自分が好きな niche tag が刺さる」
// 体験を作る。
// ----------------------------------------------------------------
function tagAffinityScore(
  postTags: string[],
  userLikedTagsFreq: Map<string, number>,
  globalTagFreq: Map<string, number>,
  totalPosts?: number,
): number {
  if (postTags.length === 0 || userLikedTagsFreq.size === 0) return 0;
  const postNorm = new Set<string>();
  for (const t of postTags) {
    const n = deepNormalize(t);
    if (n) postNorm.add(n);
  }
  if (postNorm.size === 0) return 0;

  // user liked tags も normalize 済みである前提だが、念のため normalize して比較
  const likedNorm = new Map<string, number>();
  for (const [t, freq] of userLikedTagsFreq) {
    const n = deepNormalize(t);
    if (n) likedNorm.set(n, (likedNorm.get(n) ?? 0) + freq);
  }
  if (likedNorm.size === 0) return 0;

  // N (total posts) を推定: 未指定なら globalTagFreq の max を使う
  let N = totalPosts ?? 0;
  if (N <= 0) {
    for (const v of globalTagFreq.values()) if (v > N) N = v;
  }
  if (N <= 0) N = 1;

  // 交差タグの IDF 重み付き likeFreq を加算
  let weightedInter = 0;
  for (const t of postNorm) {
    const likeFreq = likedNorm.get(t);
    if (likeFreq === undefined) continue;
    const df = globalTagFreq.get(t) ?? 1;
    const idf = Math.log((N + 1) / (df + 1)) + 1; // +1 で floor (df==N でも >0)
    // like 回数の log で head タグの過剰評価を抑え、IDF で rare boost
    weightedInter += Math.log(1 + likeFreq) * idf;
  }
  if (weightedInter === 0) return 0;

  // Jaccard 風正規化: |P ∪ L| で割る
  const union = new Set<string>([...postNorm, ...likedNorm.keys()]);
  return weightedInter / Math.sqrt(union.size);
}

// ----------------------------------------------------------------
// Engagement (log scale, Hacker News-inspired)
// ----------------------------------------------------------------
function engagementScore(post: Post): number {
  const likes = Math.max(0, post.likes_count ?? 0);
  const comments = Math.max(0, post.comments_count ?? 0);
  const concerns = Math.max(0, post.concern_count ?? 0);
  // like を主軸、comment は会話の盛り上がり、concern は質の警告 (マイナス)
  const positive = Math.log(1 + likes) * 1.0 + Math.log(1 + comments) * 0.6;
  const negative = Math.log(1 + concerns) * 0.4;
  return positive - negative;
}

// ----------------------------------------------------------------
// Time decay (Hacker News style: score / (hours + 2) ** decayExp)
// engagement が多い post は decayExp を 1.8 → 1.4 に緩める
// ----------------------------------------------------------------
function timeDecayMultiplier(post: Post, now: Date): number {
  const t = new Date(post.created_at).getTime();
  if (!Number.isFinite(t)) return 0.1;
  const hours = Math.max(0, (now.getTime() - t) / 3_600_000);
  const eng = (post.likes_count ?? 0) + (post.comments_count ?? 0);
  // 反応が多いほど (>= 50) decay を緩める。連続線形補間で滑らかに。
  const slack = Math.min(eng / 100, 1); // 0 → 1
  const decayExp = 1.8 - 0.4 * slack;
  return 1 / Math.pow(hours + 2, decayExp);
}

// ----------------------------------------------------------------
// Public: computePostScore
// ----------------------------------------------------------------
export function computePostScore(input: ScoreInput): number {
  const { post, userLikedTagsFreq, globalTagFreq, now, myAccountAgeDays } = input;

  // --- 1. tag affinity (Jaccard × TF-IDF) ---
  const tags = post.tag_names ?? [];
  const aff = tagAffinityScore(tags, userLikedTagsFreq, globalTagFreq, input.totalPosts);

  // --- 2. engagement (log scale) ---
  const eng = engagementScore(post);

  // --- 3. time decay ---
  const decay = timeDecayMultiplier(post, now);

  // --- 4. fresh boost: 1 時間以内 ---
  const t = new Date(post.created_at).getTime();
  const hours = Number.isFinite(t) ? Math.max(0, (now.getTime() - t) / 3_600_000) : Infinity;
  const freshBoost = hours <= 1 ? 6 : 0;

  // --- 5. fresh-user exploration noise (< 7 日) ---
  let exploreNoise = 0;
  if (myAccountAgeDays >= 0 && myAccountAgeDays < 7) {
    const rnd = input.random ?? Math.random;
    // 0..1 → -1..1 → ±2
    exploreNoise = (rnd() - 0.5) * 4;
  }

  // 重み付き合計
  // - tag affinity を主軸 (18) — 個人化の核
  // - engagement (6) は中程度 — 良質な popular post を浮かせる
  // - time decay は乗数で全体に効く
  const base = 18 * aff + 6 * eng;
  return base * decay + freshBoost + exploreNoise;
}

// ============================================================
// diversifyFeed — post-process: 同じ author / 同じ tag set が連続しないように
// ------------------------------------------------------------
// 上位 maxConsecutiveFromSameAuthor 件 (default 2) までは score 順で出すが、
// それ以上連続で同じ author が並ぶ場合は次の候補と入れ替える。
// 1 つの post の dominantTag (= tag_names[0]) も同じ key として扱われる。
//
// ベスト 3 までは "本当に score が高いもの" を優先したいので diversity を
// 適用しない (要件 4)。3 件目以降から diversity penalty が効く。
// ============================================================
export function diversifyFeed(
  scored: Array<{ post: Post; score: number }>,
  maxConsecutiveFromSameAuthor = 2,
): Post[] {
  if (scored.length === 0) return [];

  // score 降順で sort (caller が既に sort 済でも安全に走る)
  const sorted = scored.slice().sort((a, b) => b.score - a.score);

  const TOP_PRESERVE = 3; // ベスト 3 までは原 score 順を維持
  const out: Post[] = [];
  // 出力末尾の "連続した同 author/tag 数" を追跡
  let lastAuthor: string | null = null;
  let lastAuthorRun = 0;
  let lastDomTag: string | null = null;
  let lastDomTagRun = 0;
  const placed = new Set<number>();

  const dominantTag = (p: Post): string | null => {
    const tags = p.tag_names ?? [];
    return tags[0] ?? null;
  };
  const authorOf = (p: Post): string | null => p.author_id ?? null;

  for (let i = 0; i < sorted.length; i++) {
    if (placed.has(i)) continue;

    // 上位 TOP_PRESERVE 個は score 順を強制
    if (out.length < TOP_PRESERVE) {
      const item = sorted[i];
      if (!item) continue;
      const p = item.post;
      out.push(p);
      placed.add(i);
      const a = authorOf(p);
      const d = dominantTag(p);
      lastAuthorRun = a !== null && a === lastAuthor ? lastAuthorRun + 1 : 1;
      lastAuthor = a;
      lastDomTagRun = d !== null && d === lastDomTag ? lastDomTagRun + 1 : 1;
      lastDomTag = d;
      continue;
    }

    // diversity 適用: 連続 author / tag 上限に当たったら下を探す
    const item = sorted[i];
    if (!item) continue;
    const candidate = item.post;
    const cAuthor = authorOf(candidate);
    const cDomTag = dominantTag(candidate);
    const wouldExceedAuthor =
      cAuthor !== null && cAuthor === lastAuthor && lastAuthorRun >= maxConsecutiveFromSameAuthor;
    const wouldExceedTag =
      cDomTag !== null && cDomTag === lastDomTag && lastDomTagRun >= maxConsecutiveFromSameAuthor;

    if (!wouldExceedAuthor && !wouldExceedTag) {
      out.push(candidate);
      placed.add(i);
      lastAuthorRun = cAuthor !== null && cAuthor === lastAuthor ? lastAuthorRun + 1 : 1;
      lastAuthor = cAuthor;
      lastDomTagRun = cDomTag !== null && cDomTag === lastDomTag ? lastDomTagRun + 1 : 1;
      lastDomTag = cDomTag;
      continue;
    }

    // 次以降から「異なる author/tag の候補」を探す
    let swappedIdx = -1;
    for (let j = i + 1; j < sorted.length; j++) {
      if (placed.has(j)) continue;
      const altItem = sorted[j];
      if (!altItem) continue;
      const altAuthor = authorOf(altItem.post);
      const altDomTag = dominantTag(altItem.post);
      const altExceedsAuthor =
        altAuthor !== null && altAuthor === lastAuthor && lastAuthorRun >= maxConsecutiveFromSameAuthor;
      const altExceedsTag =
        altDomTag !== null && altDomTag === lastDomTag && lastDomTagRun >= maxConsecutiveFromSameAuthor;
      if (!altExceedsAuthor && !altExceedsTag) {
        swappedIdx = j;
        break;
      }
    }
    if (swappedIdx >= 0) {
      const swapped = sorted[swappedIdx];
      if (swapped) {
        out.push(swapped.post);
        placed.add(swappedIdx);
        const a = authorOf(swapped.post);
        const d = dominantTag(swapped.post);
        lastAuthorRun = a !== null && a === lastAuthor ? lastAuthorRun + 1 : 1;
        lastAuthor = a;
        lastDomTagRun = d !== null && d === lastDomTag ? lastDomTagRun + 1 : 1;
        lastDomTag = d;
        // 元の i 番目は次の iteration で再評価される (placed には入れない)
        // ただし無限ループ防止のため、次の周回で進めるよう本ループの i は据え置く。
        // forループは i++ で必ず進むので、現候補は最終的に末尾でフォールバックされる。
      }
      continue;
    }

    // 適切な代替が無ければ、上限を破ってでも採用 (= fallback)
    out.push(candidate);
    placed.add(i);
    lastAuthorRun = cAuthor !== null && cAuthor === lastAuthor ? lastAuthorRun + 1 : 1;
    lastAuthor = cAuthor;
    lastDomTagRun = cDomTag !== null && cDomTag === lastDomTag ? lastDomTagRun + 1 : 1;
    lastDomTag = cDomTag;
  }

  // 漏れた要素 (placed されてない) を末尾に追加 (見落とし防止)
  for (let i = 0; i < sorted.length; i++) {
    if (placed.has(i)) continue;
    const item = sorted[i];
    if (item) out.push(item.post);
  }

  return out;
}
