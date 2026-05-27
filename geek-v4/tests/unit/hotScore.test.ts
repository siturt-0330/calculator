// ============================================================
// hotScore — computeHotScore の unit test
// ============================================================
// 仕様: supabase/migrations/0058_hot_score.sql と
//        lib/utils/hotScore.ts が同じ式を計算することを確認。
//
//   score = log10(max(|s|, 1)) + sign(s) * (epoch - GEEK_LAUNCH) / 28800
//
//   - s = likes - concerns
//   - GEEK_LAUNCH_EPOCH = 1715817600 (2024-05-16 UTC)
//   - HOT_TIME_DIVISOR = 28800 sec (8h)
// ============================================================

import {
  computeHotScore,
  GEEK_LAUNCH_EPOCH,
  HOT_TIME_DIVISOR,
} from '../../lib/utils/hotScore';

// 基準時刻 — Geek launch から 1 日後 (= 86400 sec)。t = 86400。
const T0_ISO = '2024-05-17T00:00:00.000Z';
const T0_EPOCH = 1715817600 + 86400;
const T_OFFSET = 86400;

describe('exports', () => {
  it('exports GEEK_LAUNCH_EPOCH = 1715817600 (2024-05-16 UTC)', () => {
    expect(GEEK_LAUNCH_EPOCH).toBe(1715817600);
  });

  it('exports HOT_TIME_DIVISOR = 28800 (8h in seconds)', () => {
    expect(HOT_TIME_DIVISOR).toBe(28800);
  });

  it('Date.parse(GEEK_LAUNCH origin) maps to 2024-05-16 UTC', () => {
    expect(GEEK_LAUNCH_EPOCH * 1000).toBe(Date.parse('2024-05-16T00:00:00.000Z'));
  });
});

describe('computeHotScore — basic formula', () => {
  it('s = 0 (likes == concerns) → log10(1) + 0 = 0 regardless of time', () => {
    const score = computeHotScore({
      likesCount: 5,
      concernCount: 5,
      createdAt: T0_ISO,
    });
    expect(score).toBe(0);
  });

  it('s = 1 at launch epoch → log10(1) + 1 * 0 / 28800 = 0', () => {
    const score = computeHotScore({
      likesCount: 1,
      concernCount: 0,
      createdAt: '2024-05-16T00:00:00.000Z',
    });
    expect(score).toBeCloseTo(0, 10);
  });

  it('s = 10, at launch+1day → log10(10) + 86400/28800 = 1 + 3 = 4', () => {
    const score = computeHotScore({
      likesCount: 10,
      concernCount: 0,
      createdAt: T0_ISO,
    });
    expect(score).toBeCloseTo(1 + T_OFFSET / HOT_TIME_DIVISOR, 6);
    expect(score).toBeCloseTo(4, 6);
  });

  it('s = 100, at launch+1day → log10(100) + 3 = 5', () => {
    const score = computeHotScore({
      likesCount: 100,
      concernCount: 0,
      createdAt: T0_ISO,
    });
    expect(score).toBeCloseTo(2 + 3, 6);
  });
});

describe('computeHotScore — negative s (concerns > likes)', () => {
  it('s = -10, at launch+1day → log10(10) - 3 = 1 - 3 = -2', () => {
    // 式: log10(max(|s|,1)) + sign(s) * t / 28800
    //   = log10(10) + (-1) * 86400/28800
    //   = 1 - 3 = -2
    // log10 項は常に非負なので、(+s) と (-s) は対称ではなく asymmetric。
    // これは Reddit のオリジナル式と同じ — 古い downvoted post を沈める。
    const score = computeHotScore({
      likesCount: 0,
      concernCount: 10,
      createdAt: T0_ISO,
    });
    expect(score).toBeCloseTo(1 - T_OFFSET / HOT_TIME_DIVISOR, 6);
    expect(score).toBeCloseTo(-2, 6);
  });

  it('s = -1 at launch epoch → log10(1) + (-1)*0/28800 = 0', () => {
    const score = computeHotScore({
      likesCount: 0,
      concernCount: 1,
      createdAt: '2024-05-16T00:00:00.000Z',
    });
    expect(score).toBeCloseTo(0, 10);
  });

  it('sign(s) inverts time contribution — negative s では時間項が負', () => {
    // 同 |s| なら log10 項は同じ。差は time 項の sign のみ。
    //   positive = log10(|s|) + t/28800
    //   negative = log10(|s|) - t/28800
    // → positive - negative = 2 * t / 28800
    const positive = computeHotScore({
      likesCount: 10,
      concernCount: 0,
      createdAt: T0_ISO,
    });
    const negative = computeHotScore({
      likesCount: 0,
      concernCount: 10,
      createdAt: T0_ISO,
    });
    expect(positive - negative).toBeCloseTo((2 * T_OFFSET) / HOT_TIME_DIVISOR, 6);
    expect(positive - negative).toBeCloseTo(6, 6);
  });
});

describe('computeHotScore — time wins over likes within HOT_TIME_DIVISOR scale', () => {
  it('新しい 10-like post が古い 100-like post を上回る (時間差 > 8h)', () => {
    // 新しい post: s=10 at launch+2day  → 1 + 2*86400/28800 = 1 + 6 = 7
    // 古い post:   s=100 at launch+1day → 2 + 1*86400/28800 = 2 + 3 = 5
    const newer = computeHotScore({
      likesCount: 10,
      concernCount: 0,
      createdAt: '2024-05-18T00:00:00.000Z',
    });
    const older = computeHotScore({
      likesCount: 100,
      concernCount: 0,
      createdAt: T0_ISO,
    });
    expect(newer).toBeGreaterThan(older);
  });

  it('古い高 like post が新しい低 like post を上回る (時間差 < 8h × log10(1000) 桁)', () => {
    // 古い post:   s=1000 at T0           → 3 + 3 = 6
    // 新しい post: s=2 at T0 + 4h         → log10(2) + (86400+14400)/28800 = 0.301 + 3.5 = 3.801
    const oldHigh = computeHotScore({
      likesCount: 1000,
      concernCount: 0,
      createdAt: T0_ISO,
    });
    const newLow = computeHotScore({
      likesCount: 2,
      concernCount: 0,
      createdAt: '2024-05-17T04:00:00.000Z',
    });
    expect(oldHigh).toBeGreaterThan(newLow);
  });
});

describe('computeHotScore — input formats', () => {
  it('accepts ISO string', () => {
    const a = computeHotScore({ likesCount: 10, concernCount: 0, createdAt: T0_ISO });
    expect(a).toBeCloseTo(4, 6);
  });

  it('accepts epoch ms number', () => {
    const a = computeHotScore({
      likesCount: 10,
      concernCount: 0,
      createdAt: T0_EPOCH * 1000,
    });
    expect(a).toBeCloseTo(4, 6);
  });

  it('accepts Date instance', () => {
    const a = computeHotScore({
      likesCount: 10,
      concernCount: 0,
      createdAt: new Date(T0_EPOCH * 1000),
    });
    expect(a).toBeCloseTo(4, 6);
  });
});

describe('computeHotScore — defensive parsing', () => {
  it('invalid date string → 0', () => {
    expect(
      computeHotScore({
        likesCount: 10,
        concernCount: 0,
        createdAt: 'not-a-date',
      }),
    ).toBe(0);
  });

  it('NaN epoch ms → 0', () => {
    expect(
      computeHotScore({
        likesCount: 10,
        concernCount: 0,
        createdAt: NaN,
      }),
    ).toBe(0);
  });

  it('negative likes/concerns are clamped to 0', () => {
    // likes=-5 → 0, concerns=0 → s=0 → log10(1) + 0 = 0
    expect(
      computeHotScore({
        likesCount: -5,
        concernCount: 0,
        createdAt: T0_ISO,
      }),
    ).toBe(0);
  });

  it('NaN counts are treated as 0', () => {
    expect(
      computeHotScore({
        likesCount: NaN,
        concernCount: NaN,
        createdAt: T0_ISO,
      }),
    ).toBe(0);
  });
});

describe('computeHotScore — tie-break sanity (same s, different time)', () => {
  it('同 score 同 likes だと createdAt が新しい方が高い', () => {
    const newer = computeHotScore({
      likesCount: 10,
      concernCount: 0,
      createdAt: '2024-05-18T00:00:00.000Z',
    });
    const older = computeHotScore({
      likesCount: 10,
      concernCount: 0,
      createdAt: T0_ISO,
    });
    expect(newer).toBeGreaterThan(older);
    // 差は ちょうど 1 日 / 28800 = 3.0
    expect(newer - older).toBeCloseTo(86400 / HOT_TIME_DIVISOR, 6);
  });
});

describe('computeHotScore — sign asymmetry (Reddit と同じ)', () => {
  it('s と -s は log10 項を共有し、time 項のみ sign が反転する', () => {
    // pos = log10(50) + t/28800
    // neg = log10(50) - t/28800
    // → pos + neg = 2*log10(50) (時間項は相殺)
    const pos = computeHotScore({
      likesCount: 50,
      concernCount: 0,
      createdAt: T0_ISO,
    });
    const neg = computeHotScore({
      likesCount: 0,
      concernCount: 50,
      createdAt: T0_ISO,
    });
    expect(pos + neg).toBeCloseTo(2 * Math.log10(50), 6);
  });
});
