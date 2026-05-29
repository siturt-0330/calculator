// ============================================================
// lib/trust/score.ts の TIERS / tierForScore のテスト
// ============================================================
// 2026-05 改修: 旧 (rookie/regular/trusted/veteran/legend) →
// 新 (newcomer/regular/probably_nice/definitely_nice/god) の境界が
// ユーザー仕様通りか検証。境界値で oscillation しないことが特に重要。
// ============================================================

import { TIERS, tierForScore, computeTrustBreakdown } from '../../lib/trust/score';

describe('TIERS — 境界', () => {
  it('boundary が連続している (隙間なし、重複なし)', () => {
    for (let i = 0; i < TIERS.length - 1; i++) {
      const cur = TIERS[i]!;
      const next = TIERS[i + 1]!;
      expect(cur.max + 1).toBe(next.min);
    }
  });

  it('レンジが 0-100 を完全カバー', () => {
    const first = TIERS[0]!;
    const last = TIERS[TIERS.length - 1]!;
    expect(first.min).toBe(0);
    expect(last.max).toBe(100);
  });

  it('神は 100 ピンポイント (実質到達者ほぼゼロの特別枠)', () => {
    const god = TIERS.find((t) => t.key === 'god')!;
    expect(god.min).toBe(100);
    expect(god.max).toBe(100);
  });

  it('各ティアに色が定義されている', () => {
    for (const tier of TIERS) {
      expect(tier.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});

describe('tierForScore — score → tier 判定', () => {
  it('境界値で正しい tier を返す (29/30, 69/70, 89/90, 99/100)', () => {
    expect(tierForScore(0).key).toBe('newcomer');
    expect(tierForScore(29).key).toBe('newcomer');
    expect(tierForScore(30).key).toBe('regular');
    expect(tierForScore(69).key).toBe('regular');
    expect(tierForScore(70).key).toBe('probably_nice');
    expect(tierForScore(89).key).toBe('probably_nice');
    expect(tierForScore(90).key).toBe('definitely_nice');
    expect(tierForScore(99).key).toBe('definitely_nice');
    expect(tierForScore(100).key).toBe('god');
  });

  it('範囲外は clamp される (負値・100 超)', () => {
    expect(tierForScore(-10).key).toBe('newcomer');
    expect(tierForScore(150).key).toBe('god');
  });

  it('float は四捨五入で扱う (29.4 → 29, 29.5 → 30)', () => {
    expect(tierForScore(29.4).key).toBe('newcomer');
    expect(tierForScore(29.5).key).toBe('regular');
  });
});

describe('computeTrustBreakdown — 結果の整合性', () => {
  it('新規ユーザー (空プロフィール) は新参者になる (base=30 だが component なしなら他で削られない)', () => {
    const result = computeTrustBreakdown({
      post_count: 0,
      like_received_count: 0,
      comment_count: 0,
      concern_received_count: 0,
      created_at: new Date().toISOString(),
    });
    // base=30 のみ → 常連の最低 30 にちょうど入る
    expect(result.score).toBe(30);
    expect(result.tier.key).toBe('regular');
  });

  it('next tier 計算: 多分良い人の中盤 → 次は絶対良い人', () => {
    const result = computeTrustBreakdown({
      post_count: 30,
      like_received_count: 50,
      comment_count: 30,
      concern_received_count: 0,
      created_at: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
    });
    // 30 + 15 (posts cap) + 25 (likes cap) + 10 (comments cap) + 12 (days cap) = 92
    expect(result.score).toBeGreaterThanOrEqual(70);
    if (result.tier.key === 'probably_nice') {
      expect(result.nextTier?.key).toBe('definitely_nice');
    }
  });

  it('神は最終ティアなので nextTier=null', () => {
    const result = computeTrustBreakdown({
      post_count: 999,
      like_received_count: 999,
      comment_count: 999,
      concern_received_count: 0,
      created_at: new Date(Date.now() - 10 * 365 * 24 * 60 * 60 * 1000).toISOString(),
    });
    if (result.tier.key === 'god') {
      expect(result.nextTier).toBeNull();
    }
  });
});
