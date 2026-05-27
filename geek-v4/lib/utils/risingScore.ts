// ============================================================
// risingScore — Reddit 風「Rising (急上昇)」ソート helper
// ------------------------------------------------------------
// 「投稿してから極短時間で多く反応を集めている post」を浮かす純関数群。
// 目的:
//   - Reddit の Rising / Hacker News の "rising" 列に相当する高速 trending
//   - 既存 hot/top と違い、絶対 like 数ではなく **速度** で並べる
//
// 計算:
//   risingScore = likes / max(minutes_since_post, 1)
//
//   - minutes が 0 (= 投稿直後) で 0 除算しないよう floor 1
//   - 「likes/分」の単位 — 直感的に「1 分で何 like 来てるか」
//
// 制約:
//   - 直近 3 時間以内の post のみが Rising 対象 (古い post は除外)
//     → DB スキーマ変更なしで client-side filter する
//   - 候補は created_at desc で limit 100 を fetch → ここで再ランク → top 30
//
// pure: 副作用なし。test しやすい contract (now / threshold を引数で注入)。
// ============================================================

export const RISING_WINDOW_MS = 3 * 60 * 60 * 1000; // 3 hours
export const RISING_TOP_N = 30;

/**
 * 投稿の「上昇速度」スコアを返す。
 *
 * @param likes   投稿の現在のいいね数 (>= 0、不正値は 0 として扱う)
 * @param createdAtMs 投稿時刻 (Date.parse 後の epoch ms)
 * @param nowMs   現在時刻 (epoch ms)
 *
 * @returns likes / max(minutes_since_post, 1)。
 *          createdAt が未来の場合 (= 時刻ズレ等) は 0 を返す。
 *          createdAt が不正な場合も 0。
 */
export function computeRisingScore(
  likes: number,
  createdAtMs: number,
  nowMs: number,
): number {
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(nowMs)) return 0;
  const safeLikes = Number.isFinite(likes) && likes > 0 ? likes : 0;
  const elapsedMs = nowMs - createdAtMs;
  // 未来 timestamp は無視 (clock skew 対策)
  if (elapsedMs < 0) return 0;
  // 分単位に変換、最低 1 分 (0 除算回避 + 投稿直後の score 爆発を抑制)
  const minutes = Math.max(elapsedMs / 60_000, 1);
  return safeLikes / minutes;
}

/**
 * 投稿が Rising 対象 window (default: 直近 3h) に入っているか判定。
 *
 * @param createdAtMs 投稿時刻 (epoch ms)
 * @param nowMs       現在時刻 (epoch ms)
 * @param windowMs    対象 window (default: 3 時間)
 */
export function isWithinRisingWindow(
  createdAtMs: number,
  nowMs: number,
  windowMs: number = RISING_WINDOW_MS,
): boolean {
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(nowMs)) return false;
  const elapsedMs = nowMs - createdAtMs;
  // 過去 windowMs 以内、かつ未来 timestamp は弾く
  return elapsedMs >= 0 && elapsedMs <= windowMs;
}

// ============================================================
// rankByRising — generic ranker
// ------------------------------------------------------------
// post 一覧 (likes_count + created_at を持つ) を受け取り:
//   1. windowMs 内の post だけ filter
//   2. computeRisingScore 降順で sort
//   3. 上位 topN を切り出して返す
//
// 同 score の場合は created_at が新しい方を上位に (安定性のため)。
// ============================================================
export type RisingCandidate = {
  id: string;
  likes_count: number;
  created_at: string;
};

export function rankByRising<T extends RisingCandidate>(
  posts: readonly T[],
  nowMs: number,
  opts: { topN?: number; windowMs?: number } = {},
): T[] {
  const topN = opts.topN ?? RISING_TOP_N;
  const windowMs = opts.windowMs ?? RISING_WINDOW_MS;
  if (!Array.isArray(posts) || posts.length === 0) return [];

  const scored: Array<{ post: T; score: number; createdAtMs: number }> = [];
  for (const p of posts) {
    const createdAtMs = Date.parse(p.created_at);
    if (!isWithinRisingWindow(createdAtMs, nowMs, windowMs)) continue;
    const score = computeRisingScore(p.likes_count ?? 0, createdAtMs, nowMs);
    scored.push({ post: p, score, createdAtMs });
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // tie-break: 新しい方を上に
    return b.createdAtMs - a.createdAtMs;
  });
  return scored.slice(0, Math.max(0, topN)).map((r) => r.post);
}
