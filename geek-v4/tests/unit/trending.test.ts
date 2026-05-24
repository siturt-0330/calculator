// ============================================================
// trending — multi-window + spike + diversity の logic test
// ============================================================
// 実 supabase 呼び出しは fetchTrendingTags 関数内なので、ここでは
// pure helper (computeTrending / applyTrendingDiversity / isGossipBlocked)
// を直接テストする。
// ============================================================

import {
  computeTrending,
  applyTrendingDiversity,
  isGossipBlocked,
  MIN_RECENT_FOR_SPIKE,
  SPIKE_RATIO,
  DIVERSITY_THRESHOLD,
  type TagCounts,
  type TrendingTag,
} from '../../lib/api/trendingLogic';
import type { CooccurMap } from '../../lib/tagClustering/suggest';

const now = Date.now();
const HOUR = 1000 * 60 * 60;

function mkCounts(recent: number, prev: number, spanHours = 6): TagCounts {
  return {
    recent,
    prev,
    oldest: now - spanHours * HOUR,
    newest: now,
  };
}

describe('isGossipBlocked', () => {
  it('triggers 部分一致を弾く', () => {
    expect(isGossipBlocked('A 炎上中')).toBe(true);
    expect(isGossipBlocked('B 逮捕')).toBe(true);
    expect(isGossipBlocked('訃報まとめ')).toBe(true);
  });

  it('普通のタグは通す', () => {
    expect(isGossipBlocked('乃木坂46')).toBe(false);
    expect(isGossipBlocked('Vtuber')).toBe(false);
    expect(isGossipBlocked('ラーメン')).toBe(false);
  });
});

describe('computeTrending — spike detection', () => {
  it('recent < MIN_RECENT_FOR_SPIKE → spike にならない (false positive 防止)', () => {
    const counts = {
      A: mkCounts(1, 0),  // recent=1 だけ、24h spike 閾値 5 未満
    };
    const r = computeTrending(counts, {}, '24h');
    expect(r[0]!.isSpike).toBe(false);
  });

  it('recent >= MIN かつ ratio >= SPIKE_RATIO → spike', () => {
    const min = MIN_RECENT_FOR_SPIKE['24h'];  // 5
    const counts = {
      A: mkCounts(min * 3, min),  // ratio = 3.0 >= 2.5
    };
    const r = computeTrending(counts, {}, '24h');
    expect(r[0]!.isSpike).toBe(true);
    expect(r[0]!.spikeMagnitude).toBeGreaterThanOrEqual(SPIKE_RATIO);
  });

  it('1h window では低い MIN_RECENT で spike 判定が出る', () => {
    const counts1h = { A: mkCounts(MIN_RECENT_FOR_SPIKE['1h'] + 1, 0) };
    const r1h = computeTrending(counts1h, {}, '1h');
    expect(r1h[0]!.isSpike).toBe(true);

    // 同じ count を 24h で評価 → spike にならない
    const counts24h = { A: mkCounts(MIN_RECENT_FOR_SPIKE['1h'] + 1, 0) };
    const r24h = computeTrending(counts24h, {}, '24h');
    expect(r24h[0]!.isSpike).toBe(false);
  });

  it('spike を非 spike より上に sort', () => {
    const counts = {
      Spike: mkCounts(20, 2),   // spike
      Flat:  mkCounts(100, 90), // 大量だが spike じゃない (ratio 1.1)
    };
    const r = computeTrending(counts, {}, '24h');
    expect(r[0]!.name).toBe('Spike');
    expect(r[1]!.name).toBe('Flat');
  });

  it('spike 同士は acceleration 降順', () => {
    const counts = {
      A: mkCounts(15, 1),   // accel +14, spike
      B: mkCounts(30, 2),   // accel +28, spike
    };
    const r = computeTrending(counts, {}, '24h');
    expect(r[0]!.name).toBe('B');
    expect(r[1]!.name).toBe('A');
  });

  it('totalsMap が空でも postCount を fallback として返す', () => {
    const counts = { A: mkCounts(10, 5) };
    const r = computeTrending(counts, {}, '24h');
    expect(r[0]!.totalPosts).toBe(15);  // postCount = recent + prev
  });
});

describe('applyTrendingDiversity', () => {
  const mk = (name: string, isSpike = false, postCount = 10): TrendingTag => ({
    name,
    postCount,
    totalPosts: postCount,
    velocity: 1,
    acceleration: 0,
    isSpike,
    spikeMagnitude: 1,
    window: '24h',
  });

  it('cooccur 空 → 全て return (filter なし)', () => {
    const tags = [mk('A'), mk('B'), mk('C')];
    const r = applyTrendingDiversity(tags, {}, 10);
    expect(r.length).toBe(3);
  });

  it('limit 以下 → そのまま return (早期 return)', () => {
    const tags = [mk('A'), mk('B')];
    const r = applyTrendingDiversity(tags, { A: { B: 100 } }, 10);
    expect(r.length).toBe(2);
  });

  it('強く関連するタグは silent に skip される', () => {
    // 乃木坂 / 日向坂 / 櫻坂 が cooccur 強い (count >> 8)
    const cooccur: CooccurMap = {
      乃木坂46: { 日向坂46: 30, 櫻坂46: 25 },
      日向坂46: { 乃木坂46: 30, 櫻坂46: 20 },
      櫻坂46:   { 乃木坂46: 25, 日向坂46: 20 },
      // 無関係なタグ
      ラーメン: {},
      Vtuber: {},
    };
    const tags = [
      mk('乃木坂46', true, 20),  // top spike
      mk('日向坂46', true, 18),  // 関連 — skip
      mk('櫻坂46', true, 15),    // 関連 — skip
      mk('ラーメン', false, 10),
      mk('Vtuber', false, 9),
    ];
    const r = applyTrendingDiversity(tags, cooccur, 3);
    const names = r.map((x) => x.name);
    expect(names).toContain('乃木坂46');
    expect(names).not.toContain('日向坂46');
    expect(names).not.toContain('櫻坂46');
    expect(names).toContain('ラーメン');
    expect(names).toContain('Vtuber');
  });

  it('閾値未満なら同じ cluster とみなさない', () => {
    // 弱い共起 (count 3 → relevance ~0.25 < 0.55)
    const cooccur: CooccurMap = {
      A: { B: 3 },
    };
    const tags = [mk('A'), mk('B'), mk('C')];
    const r = applyTrendingDiversity(tags, cooccur, 3);
    expect(r.length).toBe(3);
  });

  it('閾値の境界: DIVERSITY_THRESHOLD 以上で skip', () => {
    // tanh(x/12) ≥ 0.55 → x ≥ 12 * atanh(0.55) ≈ 7.4
    // count = 10 で tanh(10/12) ≈ 0.69 >> 0.55 → skip
    const cooccur: CooccurMap = { A: { B: 10 } };
    const tags = [mk('A'), mk('B')];
    const r = applyTrendingDiversity(tags, cooccur, 5);
    // limit 5 > sorted.length 2 → 早期 return: 2 個両方返る
    expect(r.length).toBe(2);

    // limit 1 で diversify が効く
    // (limit ≤ sorted.length なので diversify が走る)
    // でも limit 1 だと 1 個目しか入らない
    const tags2 = [mk('A'), mk('B'), mk('C')];
    const r2 = applyTrendingDiversity(tags2, cooccur, 2);
    // A (pick), B (関連 → skip), C (関連無し → pick)
    expect(r2.length).toBe(2);
    expect(r2[0]!.name).toBe('A');
    expect(r2[1]!.name).toBe('C');
  });
});

describe('constants', () => {
  it('SPIKE_RATIO は false positive を防ぐ程度に厳しい', () => {
    expect(SPIKE_RATIO).toBeGreaterThanOrEqual(2);
  });

  it('DIVERSITY_THRESHOLD は中程度の cooccur 以上で同 cluster とみなす', () => {
    // 0.55 ≈ cooccur count 7-8 程度の関連性
    expect(DIVERSITY_THRESHOLD).toBeGreaterThan(0.4);
    expect(DIVERSITY_THRESHOLD).toBeLessThan(0.8);
  });

  it('小さい window ほど MIN_RECENT が低い (短時間で spike 認定しやすく)', () => {
    expect(MIN_RECENT_FOR_SPIKE['1h']).toBeLessThan(MIN_RECENT_FOR_SPIKE['6h']);
    expect(MIN_RECENT_FOR_SPIKE['6h']).toBeLessThan(MIN_RECENT_FOR_SPIKE['24h']);
  });
});
