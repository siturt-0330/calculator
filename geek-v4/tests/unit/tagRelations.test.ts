// ============================================================
// tagClustering/relations — cross-algo primitive の logic test
// ============================================================
// Phase 2 で導入した getRelatedTags / expandWithCooccur / pairRelevance を
// 単体テスト。pure 関数なので supabase / RN 依存無し。
// ============================================================

import {
  getRelatedTags,
  expandWithCooccur,
  pairRelevance,
} from '../../lib/tagClustering/relations';
import type { CooccurMap } from '../../lib/tagClustering/suggest';

describe('getRelatedTags', () => {
  it('cooccur が空 → 空配列', () => {
    expect(getRelatedTags('乃木坂46', {})).toEqual([]);
  });

  it('入力タグが空文字 → 空配列', () => {
    expect(getRelatedTags('', { foo: { bar: 5 } })).toEqual([]);
  });

  it('minCount 未満は除外', () => {
    const cooccur: CooccurMap = {
      A: { B: 1, C: 5, D: 2 },
    };
    const r = getRelatedTags('A', cooccur, { minCount: 3 });
    expect(r.length).toBe(1);
    expect(r[0]!.tag).toBe('c');  // deepNormalize → lowercase
    expect(r[0]!.score).toBe(5);
  });

  it('score 降順で返す', () => {
    const cooccur: CooccurMap = {
      乃木坂46: { 日向坂46: 10, 櫻坂46: 15, 欅坂46: 8 },
    };
    const r = getRelatedTags('乃木坂46', cooccur);
    expect(r.length).toBe(3);
    expect(r[0]!.score).toBe(15);
    expect(r[1]!.score).toBe(10);
    expect(r[2]!.score).toBe(8);
  });

  it('topK で切る', () => {
    const cooccur: CooccurMap = {
      A: { B: 10, C: 9, D: 8, E: 7, F: 6 },
    };
    const r = getRelatedTags('A', cooccur, { topK: 2 });
    expect(r.length).toBe(2);
  });

  it('自分自身は除外', () => {
    // cooccur に自己ループがあっても返さない
    const cooccur: CooccurMap = {
      A: { A: 100, B: 5 },
    };
    const r = getRelatedTags('A', cooccur);
    expect(r.length).toBe(1);
    expect(r[0]!.tag).toBe('b');
  });

  it('表記揺れ (大文字小文字) を吸収', () => {
    const cooccur: CooccurMap = {
      Vtuber: { ホロライブ: 8 },
      VTUBER: { にじさんじ: 6 },
    };
    // 入力 "vtuber" でも両 key 両方から集計
    const r = getRelatedTags('vtuber', cooccur);
    expect(r.length).toBe(2);
    // 大きい方が先
    expect(r[0]!.score).toBe(8);
  });
});

describe('expandWithCooccur', () => {
  it('複数入力 → マージ済みリスト', () => {
    const cooccur: CooccurMap = {
      A: { X: 5, Y: 3 },
      B: { X: 10, Z: 4 },
    };
    const r = expandWithCooccur(['A', 'B'], cooccur);
    // X が A,B 両方の neighbor → max=10 (max マージ)
    const tagMap = Object.fromEntries(r.map((x) => [x.tag, x.score]));
    expect(tagMap.x).toBe(10);
    expect(tagMap.y).toBe(3);
    expect(tagMap.z).toBe(4);
  });

  it('入力タグ自身は結果から除外', () => {
    const cooccur: CooccurMap = {
      A: { B: 10, C: 5 },
      B: { A: 10, D: 3 },
    };
    const r = expandWithCooccur(['A', 'B'], cooccur);
    const tags = r.map((x) => x.tag);
    expect(tags).not.toContain('a');
    expect(tags).not.toContain('b');
    expect(tags).toContain('c');
    expect(tags).toContain('d');
  });

  it('cooccur が空 → 空配列', () => {
    expect(expandWithCooccur(['A', 'B'], {})).toEqual([]);
  });
});

describe('pairRelevance', () => {
  it('cooccur 無し → 0', () => {
    expect(pairRelevance('A', 'B', {})).toBe(0);
  });

  it('同一タグ → 0 (pair として無意味)', () => {
    const cooccur: CooccurMap = { A: { A: 100 } };
    expect(pairRelevance('A', 'A', cooccur)).toBe(0);
  });

  it('共起 count に応じて 0..1 で返す', () => {
    const cooccur: CooccurMap = {
      A: { B: 12 },
    };
    const r = pairRelevance('A', 'B', cooccur);
    // tanh(12/12) = tanh(1) ≈ 0.7616
    expect(r).toBeGreaterThan(0.7);
    expect(r).toBeLessThan(0.8);
  });

  it('count が大きいほど 1 に近づく', () => {
    const low: CooccurMap = { A: { B: 3 } };
    const high: CooccurMap = { A: { B: 50 } };
    expect(pairRelevance('A', 'B', high)).toBeGreaterThan(pairRelevance('A', 'B', low));
    expect(pairRelevance('A', 'B', high)).toBeLessThanOrEqual(1);
    expect(pairRelevance('A', 'B', low)).toBeGreaterThan(0);
  });

  it('双方向で max を取る (a→b と b→a の両方を見る)', () => {
    // 片方向にしか cooccur が登録されていなくても拾える
    const cooccur: CooccurMap = {
      A: { B: 5 },
      // B 方向は無い
    };
    const r = pairRelevance('B', 'A', cooccur);
    expect(r).toBeGreaterThan(0);
  });
});
