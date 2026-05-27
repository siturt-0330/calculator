// ============================================================
// rising — Reddit 風「Rising」ソート + Best コメント score の unit test
// ============================================================
// pure helper だけテストする (DB / supabase 呼び出しは含めない)。
// 期待:
//   - computeRisingScore: likes / max(min, 1)、未来や不正値の防御
//   - isWithinRisingWindow: 過去 3h 以内のみ true
//   - rankByRising: window filter + score 降順 + topN slice
//   - computeCommentBestScore: like + reply*0.5 + 1/(age_h + 2)
//   - sortCommentsByBest: 純粋 sort (immutable)
// ============================================================

import {
  computeRisingScore,
  isWithinRisingWindow,
  rankByRising,
  RISING_WINDOW_MS,
  RISING_TOP_N,
} from '../../lib/utils/risingScore';
// 同等の関数は lib/api/bbs.ts からも re-export されているが、bbs.ts は
// supabase / RN を引きずるので test は副作用ゼロの本体 file から直 import する。
import { computeCommentBestScore, sortCommentsByBest } from '../../lib/utils/commentBestScore';

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;

describe('computeRisingScore', () => {
  const now = Date.parse('2026-05-27T12:00:00.000Z');

  it('post just now (1 min minimum) — score = likes / 1', () => {
    // createdAt = now → elapsed=0 → minutes floored to 1 → score = likes
    expect(computeRisingScore(10, now, now)).toBe(10);
  });

  it('post 30 min ago with 60 likes → 2.0 likes/min', () => {
    const createdAt = now - 30 * MIN;
    expect(computeRisingScore(60, createdAt, now)).toBeCloseTo(2.0, 4);
  });

  it('post 2h ago with 60 likes → 0.5 likes/min', () => {
    const createdAt = now - 2 * HOUR;
    expect(computeRisingScore(60, createdAt, now)).toBeCloseTo(0.5, 4);
  });

  it('future post (clock skew) → 0 (defense against negative elapsed)', () => {
    const createdAt = now + 5 * MIN;
    expect(computeRisingScore(100, createdAt, now)).toBe(0);
  });

  it('negative / NaN likes → treated as 0', () => {
    expect(computeRisingScore(-5, now - 10 * MIN, now)).toBe(0);
    expect(computeRisingScore(NaN, now - 10 * MIN, now)).toBe(0);
  });

  it('invalid timestamps → 0', () => {
    expect(computeRisingScore(10, NaN, now)).toBe(0);
    expect(computeRisingScore(10, now, NaN)).toBe(0);
  });
});

describe('isWithinRisingWindow', () => {
  const now = Date.parse('2026-05-27T12:00:00.000Z');

  it('post 1h ago → within 3h window', () => {
    expect(isWithinRisingWindow(now - 1 * HOUR, now)).toBe(true);
  });

  it('post 3h ago exactly → within (boundary inclusive)', () => {
    expect(isWithinRisingWindow(now - 3 * HOUR, now)).toBe(true);
  });

  it('post 4h ago → outside window', () => {
    expect(isWithinRisingWindow(now - 4 * HOUR, now)).toBe(false);
  });

  it('future post → outside window', () => {
    expect(isWithinRisingWindow(now + 1 * MIN, now)).toBe(false);
  });

  it('custom windowMs respected', () => {
    expect(isWithinRisingWindow(now - 30 * MIN, now, 15 * MIN)).toBe(false);
    expect(isWithinRisingWindow(now - 5 * MIN, now, 15 * MIN)).toBe(true);
  });
});

describe('rankByRising', () => {
  const now = Date.parse('2026-05-27T12:00:00.000Z');

  function mk(id: string, likes: number, minutesAgo: number) {
    return {
      id,
      likes_count: likes,
      created_at: new Date(now - minutesAgo * MIN).toISOString(),
    };
  }

  it('filters out posts older than 3h window', () => {
    const posts = [
      mk('a', 100, 30),         // in window
      mk('b', 100, 60 * 4),     // 4h ago — out
      mk('c', 100, 60 * 24),    // 1d ago — out
    ];
    const ranked = rankByRising(posts, now);
    expect(ranked.map((p) => p.id)).toEqual(['a']);
  });

  it('sorts by likes/min velocity desc', () => {
    const posts = [
      mk('slow', 30, 60),       // 30 likes in 60min = 0.5/min
      mk('fast', 30, 10),       // 30 likes in 10min = 3.0/min
      mk('mid', 30, 30),        // 30 likes in 30min = 1.0/min
    ];
    const ranked = rankByRising(posts, now);
    expect(ranked.map((p) => p.id)).toEqual(['fast', 'mid', 'slow']);
  });

  it('tie-break: same score → newer post first', () => {
    const posts = [
      mk('older', 10, 10),  // 10 likes in 10 min = 1.0
      mk('newer', 5, 5),    // 5 likes in 5 min = 1.0 (same score)
    ];
    const ranked = rankByRising(posts, now);
    expect(ranked[0]?.id).toBe('newer');
    expect(ranked[1]?.id).toBe('older');
  });

  it('limits to topN (default 30)', () => {
    // 40 posts in window, all with same age 30min but different likes
    const posts = Array.from({ length: 40 }, (_, i) => mk(`p${i}`, 100 - i, 30));
    const ranked = rankByRising(posts, now);
    expect(ranked.length).toBe(RISING_TOP_N);
    // top should be p0 (highest likes)
    expect(ranked[0]?.id).toBe('p0');
  });

  it('respects custom topN', () => {
    const posts = Array.from({ length: 10 }, (_, i) => mk(`p${i}`, 100 - i, 30));
    const ranked = rankByRising(posts, now, { topN: 3 });
    expect(ranked.length).toBe(3);
  });

  it('empty input → empty output', () => {
    expect(rankByRising([], now)).toEqual([]);
  });

  it('exports RISING_WINDOW_MS = 3 hours', () => {
    expect(RISING_WINDOW_MS).toBe(3 * HOUR);
  });
});

describe('computeCommentBestScore', () => {
  const now = Date.parse('2026-05-27T12:00:00.000Z');

  it('age boost: 0h → 1/2 = 0.5', () => {
    const c = { created_at: new Date(now).toISOString() };
    expect(computeCommentBestScore(c, now)).toBeCloseTo(0.5, 4);
  });

  it('age boost: 2h → 1/4 = 0.25', () => {
    const c = { created_at: new Date(now - 2 * HOUR).toISOString() };
    expect(computeCommentBestScore(c, now)).toBeCloseTo(0.25, 4);
  });

  it('formula: 10 likes + 4 replies + 2h old → 10 + 2 + 0.25 = 12.25', () => {
    const c = {
      created_at: new Date(now - 2 * HOUR).toISOString(),
      like_count: 10,
      reply_count: 4,
    };
    expect(computeCommentBestScore(c, now)).toBeCloseTo(12.25, 4);
  });

  it('missing counters → treated as 0', () => {
    const c = { created_at: new Date(now - 2 * HOUR).toISOString() };
    expect(computeCommentBestScore(c, now)).toBeCloseTo(0.25, 4);
  });

  it('negative counters → clamped to 0', () => {
    const c = {
      created_at: new Date(now).toISOString(),
      like_count: -5,
      reply_count: -2,
    };
    // -5 + -2*0.5 = -6 → clamp → 0 + 0 + 0.5 = 0.5
    expect(computeCommentBestScore(c, now)).toBeCloseTo(0.5, 4);
  });

  it('invalid timestamp → time boost = 0', () => {
    const c = { created_at: 'not-a-date', like_count: 3, reply_count: 0 };
    expect(computeCommentBestScore(c, now)).toBe(3);
  });
});

describe('sortCommentsByBest', () => {
  const now = Date.parse('2026-05-27T12:00:00.000Z');

  it('orders by Best score desc — likes dominate over age', () => {
    const comments = [
      { id: 'fresh-low', created_at: new Date(now).toISOString(), like_count: 1 },
      { id: 'old-high', created_at: new Date(now - 5 * HOUR).toISOString(), like_count: 100 },
      { id: 'mid', created_at: new Date(now - 1 * HOUR).toISOString(), like_count: 10 },
    ];
    const sorted = sortCommentsByBest(comments, now);
    expect(sorted.map((c) => c.id)).toEqual(['old-high', 'mid', 'fresh-low']);
  });

  it('no counters → behaves like "newest first" via timeBonus', () => {
    const comments = [
      { id: 'old', created_at: new Date(now - 5 * HOUR).toISOString() },
      { id: 'mid', created_at: new Date(now - 1 * HOUR).toISOString() },
      { id: 'new', created_at: new Date(now - 1 * MIN).toISOString() },
    ];
    const sorted = sortCommentsByBest(comments, now);
    expect(sorted.map((c) => c.id)).toEqual(['new', 'mid', 'old']);
  });

  it('input array is not mutated', () => {
    const comments = [
      { id: 'a', created_at: new Date(now - 1 * HOUR).toISOString(), like_count: 5 },
      { id: 'b', created_at: new Date(now).toISOString(), like_count: 1 },
    ];
    const before = comments.map((c) => c.id);
    sortCommentsByBest(comments, now);
    expect(comments.map((c) => c.id)).toEqual(before);
  });
});
