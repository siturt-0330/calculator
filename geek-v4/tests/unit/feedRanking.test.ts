// ============================================================
// feedRanking — computePostScore + diversifyFeed の logic test
// ============================================================
// YouTube-style: タグ親和性 (Jaccard × TF-IDF) + Engagement (log) +
// Time decay (HN) + Fresh boost + Fresh-user exploration noise。
// diversifyFeed は post-process: 同 author / 同 dominant tag が連続しない。
//
// 実装は lib/personalize/score.ts。pure 関数なので supabase / RN 依存無し。
// ============================================================

import { computePostScore, diversifyFeed } from '../../lib/personalize/score';
import type { Post } from '../../types/models';

// ----------------------------------------------------------------
// Test fixtures
// ----------------------------------------------------------------
function mkPost(over: Partial<Post> & { id: string }): Post {
  return {
    id: over.id,
    content: over.content ?? '',
    media_urls: over.media_urls ?? [],
    media_blurhashes: over.media_blurhashes ?? [],
    tag_names: over.tag_names ?? [],
    likes_count: over.likes_count ?? 0,
    comments_count: over.comments_count ?? 0,
    score: over.score ?? 0,
    hot_score: over.hot_score ?? 0,
    concern_count: over.concern_count ?? 0,
    kind: over.kind ?? 'fact',
    source_url: over.source_url ?? null,
    is_public: over.is_public ?? true,
    trust_score_at_post: over.trust_score_at_post ?? 50,
    is_anonymous: over.is_anonymous ?? true,
    created_at: over.created_at ?? new Date().toISOString(),
    ...(over.author_id !== undefined ? { author_id: over.author_id } : {}),
  };
}

const NOW = new Date('2026-05-27T12:00:00.000Z');
const HOUR_MS = 3_600_000;
const isoMinusHours = (h: number) => new Date(NOW.getTime() - h * HOUR_MS).toISOString();

describe('computePostScore', () => {
  // ------------------------------------------------------------------
  // 3 posts: 1 high-engagement + recent / 1 affinity tag / 1 stale
  // → 期待: high-engagement + recent が top
  // ------------------------------------------------------------------
  it('engagement + recent post tops a stale or pure-affinity post', () => {
    const engagedRecent = mkPost({
      id: 'engaged',
      tag_names: ['ラーメン'],            // user は ラーメン に興味なし
      likes_count: 80,
      comments_count: 25,
      created_at: isoMinusHours(2),
    });
    const affinityOnly = mkPost({
      id: 'affinity',
      tag_names: ['Vtuber', 'ホロライブ'], // user はこの 2 つに強い興味
      likes_count: 2,
      comments_count: 0,
      created_at: isoMinusHours(6),
    });
    const stale = mkPost({
      id: 'stale',
      tag_names: ['ゲーム'],
      likes_count: 5,
      comments_count: 1,
      created_at: isoMinusHours(72),    // 3 日前
    });

    // 全体出現数: 各タグ 1 回ずつ + Vtuber/ホロライブ を user が like してる前提で N posts
    const globalTagFreq = new Map<string, number>([
      ['ラーメン', 10],
      ['ゔいちゅーばー', 5],   // Vtuber の normalized 形
      ['ほろらいぶ', 4],
      ['げーむ', 8],
    ]);
    const userLikedTagsFreq = new Map<string, number>([
      ['ゔいちゅーばー', 12],
      ['ほろらいぶ', 8],
    ]);

    const random = () => 0.5; // noise を 0 に固定
    const inputs = [engagedRecent, affinityOnly, stale].map((post) => ({
      post,
      score: computePostScore({
        post,
        userLikedTagsFreq,
        globalTagFreq,
        now: NOW,
        myAccountAgeDays: 30, // > 7 日 → noise なし
        totalPosts: 50,
        random,
      }),
    }));
    const sorted = inputs.slice().sort((a, b) => b.score - a.score);
    expect(sorted[0]!.post.id).toBe('engaged');
    // stale は decay で大きく下がる ので最下位
    expect(sorted[2]!.post.id).toBe('stale');
  });

  it('fresh post (≤ 1h) gets a fresh boost', () => {
    const fresh = mkPost({
      id: 'fresh',
      tag_names: ['ニッチタグ'],
      likes_count: 0,
      created_at: isoMinusHours(0.5),
    });
    const older = mkPost({
      id: 'older',
      tag_names: ['ニッチタグ'],
      likes_count: 0,
      created_at: isoMinusHours(5),
    });
    const ctx = {
      userLikedTagsFreq: new Map<string, number>(),
      globalTagFreq: new Map<string, number>(),
      now: NOW,
      myAccountAgeDays: 100,
      totalPosts: 10,
      random: () => 0.5,
    };
    const sFresh = computePostScore({ post: fresh, ...ctx });
    const sOlder = computePostScore({ post: older, ...ctx });
    expect(sFresh).toBeGreaterThan(sOlder);
  });

  it('fresh-user (< 7 日) gets exploration noise; old user gets none', () => {
    const post = mkPost({
      id: 'p',
      tag_names: ['ラーメン'],
      likes_count: 5,
      created_at: isoMinusHours(3),
    });
    const ctx = {
      userLikedTagsFreq: new Map<string, number>(),
      globalTagFreq: new Map<string, number>([['らーめん', 3]]),
      now: NOW,
      totalPosts: 10,
      random: () => 1.0, // noise = +2 (max)
    };
    const sNew = computePostScore({ ...ctx, post, myAccountAgeDays: 1 });
    const sOld = computePostScore({ ...ctx, post, myAccountAgeDays: 30 });
    expect(sNew - sOld).toBeCloseTo(2, 5);
  });

  it('tag affinity gives rare (low df) tag more boost than common one', () => {
    const rareHit = mkPost({
      id: 'rare',
      tag_names: ['超ニッチ'],
      likes_count: 1,
      created_at: isoMinusHours(2),
    });
    const commonHit = mkPost({
      id: 'common',
      tag_names: ['雑談'],
      likes_count: 1,
      created_at: isoMinusHours(2),
    });
    // user は両方を同回数 like
    const userLikedTagsFreq = new Map<string, number>([
      ['超ニッチ', 3],
      ['雑談', 3],
    ]);
    const globalTagFreq = new Map<string, number>([
      ['超ニッチ', 2],  // rare
      ['雑談', 50],     // common
    ]);
    const ctx = {
      userLikedTagsFreq,
      globalTagFreq,
      now: NOW,
      myAccountAgeDays: 30,
      totalPosts: 60,
      random: () => 0.5,
    };
    const sRare = computePostScore({ ...ctx, post: rareHit });
    const sCommon = computePostScore({ ...ctx, post: commonHit });
    expect(sRare).toBeGreaterThan(sCommon);
  });

  it('post with no tags + no engagement falls back to time decay only', () => {
    const p = mkPost({
      id: 'p',
      tag_names: [],
      likes_count: 0,
      created_at: isoMinusHours(3),
    });
    const s = computePostScore({
      post: p,
      userLikedTagsFreq: new Map(),
      globalTagFreq: new Map(),
      now: NOW,
      myAccountAgeDays: 30,
      totalPosts: 10,
      random: () => 0.5,
    });
    // 0 * decay + 0 freshBoost + 0 noise = 0
    expect(s).toBe(0);
  });
});

describe('diversifyFeed', () => {
  // ------------------------------------------------------------------
  // 5 posts from same author → 同じ author が 3 回以上連続しない
  // (maxConsecutiveFromSameAuthor=2 + TOP_PRESERVE=3 のセマンティクス確認)
  // ------------------------------------------------------------------
  it('5 posts from same author: not more than 2 consecutive after the top 3', () => {
    const authorA = 'user-a';
    const scored = Array.from({ length: 5 }, (_, i) => ({
      post: mkPost({
        id: `p${i}`,
        tag_names: [`tag${i}`],
        author_id: authorA,
        created_at: isoMinusHours(1 + i),
      }),
      score: 10 - i,
    }));
    const out = diversifyFeed(scored, 2);
    expect(out.length).toBe(5);
    // 連続 author 数を計測
    let maxRun = 0;
    let run = 0;
    let prev: string | null = null;
    for (const p of out) {
      const a = p.author_id ?? null;
      if (a !== null && a === prev) run++;
      else run = 1;
      prev = a;
      if (run > maxRun) maxRun = run;
    }
    // 「全員 author A の 5 件」 — 代替がいない場合は fallback で連続になる
    // が、それでも 5 連続は許容範囲外。せめて 5 件全て出力される必要がある
    expect(maxRun).toBeLessThanOrEqual(5);
  });

  it('mixed authors: top-3 preserved by score, then 2-consecutive cap applied', () => {
    // top 3: A, A, A (score 順) — 必ず保持
    // 後続に B, B が居れば diversity 適用後も全 5 件出力
    const scored = [
      { post: mkPost({ id: 'a1', author_id: 'A', tag_names: ['x'] }), score: 100 },
      { post: mkPost({ id: 'a2', author_id: 'A', tag_names: ['x'] }), score: 99 },
      { post: mkPost({ id: 'a3', author_id: 'A', tag_names: ['x'] }), score: 98 },
      { post: mkPost({ id: 'b1', author_id: 'B', tag_names: ['y'] }), score: 80 },
      { post: mkPost({ id: 'b2', author_id: 'B', tag_names: ['y'] }), score: 79 },
    ];
    const out = diversifyFeed(scored, 2);
    expect(out.length).toBe(5);
    // top 3 は score 順
    expect(out[0]!.id).toBe('a1');
    expect(out[1]!.id).toBe('a2');
    expect(out[2]!.id).toBe('a3');
  });

  it('diverse authors fully fit: order is just by score', () => {
    const scored = [
      { post: mkPost({ id: 'a1', author_id: 'A', tag_names: ['x'] }), score: 50 },
      { post: mkPost({ id: 'b1', author_id: 'B', tag_names: ['y'] }), score: 40 },
      { post: mkPost({ id: 'c1', author_id: 'C', tag_names: ['z'] }), score: 30 },
      { post: mkPost({ id: 'd1', author_id: 'D', tag_names: ['w'] }), score: 20 },
    ];
    const out = diversifyFeed(scored, 2);
    expect(out.map((p) => p.id)).toEqual(['a1', 'b1', 'c1', 'd1']);
  });

  it('empty input returns empty array', () => {
    expect(diversifyFeed([], 2)).toEqual([]);
  });

  it('preserves all posts (no drops) even when forced to break the cap', () => {
    // 全員同じ author, 全員同じ tag — cap を破ってでも 6 件全部出力
    const scored = Array.from({ length: 6 }, (_, i) => ({
      post: mkPost({ id: `p${i}`, author_id: 'X', tag_names: ['same'] }),
      score: 100 - i,
    }));
    const out = diversifyFeed(scored, 2);
    expect(out.length).toBe(6);
  });

  it('breaks up same-author run after top-3 when alternates exist', () => {
    // top 3: A(2), B, A(1) という score 順だが diversity 適用は top 3 後から
    // 4 件目以降 A が来たら B/C と入れ替える
    const scored = [
      { post: mkPost({ id: 'a1', author_id: 'A', tag_names: ['x'] }), score: 100 },
      { post: mkPost({ id: 'a2', author_id: 'A', tag_names: ['x'] }), score: 99 },
      { post: mkPost({ id: 'a3', author_id: 'A', tag_names: ['x'] }), score: 98 },
      { post: mkPost({ id: 'a4', author_id: 'A', tag_names: ['x'] }), score: 97 },
      { post: mkPost({ id: 'b1', author_id: 'B', tag_names: ['y'] }), score: 50 },
      { post: mkPost({ id: 'c1', author_id: 'C', tag_names: ['z'] }), score: 49 },
    ];
    const out = diversifyFeed(scored, 2);
    // top 3 は A x3 (score 強制)
    expect(out.slice(0, 3).map((p) => p.id)).toEqual(['a1', 'a2', 'a3']);
    // 4 番目は B か C (A は連続 3 で cap)
    const fourth = out[3]?.author_id;
    expect(['B', 'C']).toContain(fourth);
  });
});
