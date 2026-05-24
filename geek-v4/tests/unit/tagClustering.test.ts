// ============================================================
// suggestClusters — タグ自動グルーピング algorithm の logic test
// ============================================================
// 実装は lib/tagClustering/suggest.ts を直接 import。
// pure 関数なので supabase / react-native の依存が無く、jest で簡単に走る。
// ============================================================

import { suggestClusters } from '../../lib/tagClustering/suggest';
import type { CooccurMap } from '../../lib/tagClustering/suggest';

describe('suggestClusters', () => {
  it('共起データ無し → 空配列', () => {
    const r = suggestClusters({
      interestTags: ['乃木坂46', '日向坂46', '櫻坂46'],
      cooccur: {},
      inGraphTags: new Set(),
    });
    expect(r).toEqual([]);
  });

  it('interestTags が 3 個未満 → 空配列', () => {
    const r = suggestClusters({
      interestTags: ['乃木坂46', '日向坂46'],
      cooccur: { 乃木坂46: { 日向坂46: 5 } },
      inGraphTags: new Set(),
    });
    expect(r).toEqual([]);
  });

  it('共起が強い 4 タグ → 1 クラスタにまとまる', () => {
    const cooccur: CooccurMap = {
      乃木坂46: { 日向坂46: 12, 櫻坂46: 10, 欅坂46: 8 },
      日向坂46: { 乃木坂46: 12, 櫻坂46: 9, 欅坂46: 7 },
      櫻坂46:   { 乃木坂46: 10, 日向坂46: 9, 欅坂46: 6 },
      欅坂46:   { 乃木坂46: 8,  日向坂46: 7, 櫻坂46: 6 },
    };
    const r = suggestClusters({
      interestTags: ['乃木坂46', '日向坂46', '櫻坂46', '欅坂46'],
      cooccur,
      inGraphTags: new Set(),
    });
    expect(r.length).toBe(1);
    const c = r[0]!;
    expect(c.tags.length).toBe(4);
    expect(c.tags).toContain('乃木坂46');
    expect(c.tags).toContain('日向坂46');
    expect(c.tags).toContain('櫻坂46');
    expect(c.tags).toContain('欅坂46');
    expect(c.signals.memberCount).toBe(4);
    // hub は最も繋がりが強いタグ (乃木坂46 が他 3 個と全て高頻度)
    expect(c.hub).toBe('乃木坂46');
  });

  it('既存ノードのタグは候補から除外される', () => {
    const cooccur: CooccurMap = {
      乃木坂46: { 日向坂46: 12, 櫻坂46: 10, 欅坂46: 8 },
      日向坂46: { 乃木坂46: 12, 櫻坂46: 9, 欅坂46: 7 },
      櫻坂46:   { 乃木坂46: 10, 日向坂46: 9, 欅坂46: 6 },
      欅坂46:   { 乃木坂46: 8,  日向坂46: 7, 櫻坂46: 6 },
    };
    const r = suggestClusters({
      interestTags: ['乃木坂46', '日向坂46', '櫻坂46', '欅坂46'],
      cooccur,
      inGraphTags: new Set(['乃木坂46']), // 乃木坂46 は既にグラフ入り
    });
    // 残り 3 タグ ≥ minClusterSize なので 1 クラスタ
    expect(r.length).toBe(1);
    expect(r[0]!.tags).not.toContain('乃木坂46');
    expect(r[0]!.tags.length).toBe(3);
  });

  it('共起が弱いタグは別クラスタにならない', () => {
    const cooccur: CooccurMap = {
      A: { B: 10, C: 10 },
      B: { A: 10, C: 10 },
      C: { A: 10, B: 10 },
      X: { Y: 1 }, // 弱すぎ (minCooccur=2 未満)
      Y: { X: 1 },
    };
    const r = suggestClusters({
      interestTags: ['A', 'B', 'C', 'X', 'Y'],
      cooccur,
      inGraphTags: new Set(),
    });
    expect(r.length).toBe(1);
    expect(r[0]!.tags.sort()).toEqual(['A', 'B', 'C']);
  });

  it('表記揺れ (variant) のペアは cooccur 0 でも score にカウントされる', () => {
    // ホロライブ / Hololive / hololive は variant 関係。cooccur は 0。
    const cooccur: CooccurMap = {
      ホロライブ: { Vtuber: 8, アイドル: 6 },
      Vtuber:    { ホロライブ: 8, アイドル: 5 },
      アイドル:  { ホロライブ: 6, Vtuber: 5 },
    };
    const r = suggestClusters({
      interestTags: ['ホロライブ', 'Vtuber', 'アイドル'],
      cooccur,
      inGraphTags: new Set(),
      minClusterSize: 3,
    });
    expect(r.length).toBe(1);
    expect(r[0]!.tags.length).toBe(3);
  });

  it('confidence は 0..1 の範囲、共起が強いほど高くなる', () => {
    const high: CooccurMap = {
      A: { B: 50, C: 45, D: 40 },
      B: { A: 50, C: 30, D: 35 },
      C: { A: 45, B: 30, D: 25 },
      D: { A: 40, B: 35, C: 25 },
    };
    const low: CooccurMap = {
      P: { Q: 2, R: 2, S: 2 },
      Q: { P: 2, R: 2, S: 2 },
      R: { P: 2, Q: 2, S: 2 },
      S: { P: 2, Q: 2, R: 2 },
    };
    const high_r = suggestClusters({
      interestTags: ['A', 'B', 'C', 'D'],
      cooccur: high,
      inGraphTags: new Set(),
    });
    const low_r = suggestClusters({
      interestTags: ['P', 'Q', 'R', 'S'],
      cooccur: low,
      inGraphTags: new Set(),
    });
    expect(high_r.length).toBe(1);
    expect(low_r.length).toBe(1);
    expect(high_r[0]!.confidence).toBeGreaterThan(low_r[0]!.confidence);
    expect(high_r[0]!.confidence).toBeLessThanOrEqual(1);
    expect(low_r[0]!.confidence).toBeGreaterThanOrEqual(0);
  });

  it('上限 maxClusters を尊重', () => {
    // 2 つの完全に独立した三角形
    const cooccur: CooccurMap = {
      A: { B: 10, C: 10 }, B: { A: 10, C: 10 }, C: { A: 10, B: 10 },
      X: { Y: 10, Z: 10 }, Y: { X: 10, Z: 10 }, Z: { X: 10, Y: 10 },
    };
    const r = suggestClusters({
      interestTags: ['A', 'B', 'C', 'X', 'Y', 'Z'],
      cooccur,
      inGraphTags: new Set(),
      maxClusters: 1,
    });
    expect(r.length).toBe(1);
  });
});
