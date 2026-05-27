// ============================================================
// commentCollapse.test.ts — shouldCollapseComment + groupConsecutiveCollapsed
// ------------------------------------------------------------
// Reddit ガイド 5.3 / 5.10 の自動 collapse / グループ化 helper の unit test。
// 純関数なので supabase / RN なしで動く (jest 単体)。
// ============================================================

import {
  shouldCollapseComment,
  groupConsecutiveCollapsed,
  annotateCollapsed,
  COLLAPSE_CONCERN_THRESHOLD,
} from '../../lib/utils/commentCollapse';

describe('shouldCollapseComment', () => {
  it('returns false for empty/default comment', () => {
    expect(shouldCollapseComment({})).toBe(false);
  });

  it('returns false when concern_count is below threshold (and score path balanced)', () => {
    // concern=2, likes=2 → score=0 (>-2), concern<3 → collapse=false
    expect(
      shouldCollapseComment({
        concern_count: COLLAPSE_CONCERN_THRESHOLD - 1,
        likes_count: COLLAPSE_CONCERN_THRESHOLD - 1,
      }),
    ).toBe(false);
  });

  it('returns true exactly at concern_count = threshold', () => {
    expect(shouldCollapseComment({ concern_count: COLLAPSE_CONCERN_THRESHOLD })).toBe(true);
  });

  it('returns true above concern_count threshold', () => {
    expect(shouldCollapseComment({ concern_count: COLLAPSE_CONCERN_THRESHOLD + 5 })).toBe(true);
  });

  it('collapses when score_proxy (likes - concerns) <= threshold', () => {
    // likes=0, concerns=2 → score = -2 (= threshold)
    expect(shouldCollapseComment({ likes_count: 0, concern_count: 2 })).toBe(true);
    // likes=1, concerns=2 → score = -1 (< threshold), concern_count < 3 → collapse=false
    expect(shouldCollapseComment({ likes_count: 1, concern_count: 2 })).toBe(false);
  });

  it('does not collapse when likes outweigh concerns', () => {
    expect(shouldCollapseComment({ likes_count: 10, concern_count: 2 })).toBe(false);
  });

  it('collapses when is_hidden_by_author=true even with high likes', () => {
    expect(
      shouldCollapseComment({ likes_count: 100, concern_count: 0, is_hidden_by_author: true }),
    ).toBe(true);
  });

  it('treats negative/NaN counters as 0 (defensive)', () => {
    expect(shouldCollapseComment({ concern_count: -5 })).toBe(false);
    expect(shouldCollapseComment({ likes_count: Number.NaN, concern_count: Number.NaN })).toBe(false);
  });

  it('honors COLLAPSE_SCORE_THRESHOLD exactly', () => {
    // 上限ライン: score == threshold (=-2) → collapse
    // ※ concern_count は 3 未満 (= concern 単独 trigger を avoid) で score 経路のみ確認
    expect(shouldCollapseComment({ likes_count: 0, concern_count: 2 })).toBe(true);
    expect(shouldCollapseComment({ likes_count: 1, concern_count: 2 })).toBe(false);
  });
});

describe('groupConsecutiveCollapsed', () => {
  it('returns [] for empty input', () => {
    expect(groupConsecutiveCollapsed([])).toEqual([]);
  });

  it('returns all singles when nothing is collapsed', () => {
    const items = [
      { id: 'a', collapsed: false },
      { id: 'b', collapsed: false },
      { id: 'c', collapsed: false },
    ];
    const out = groupConsecutiveCollapsed(items);
    expect(out).toHaveLength(3);
    expect(out.every((x) => x.kind === 'single')).toBe(true);
  });

  it('treats single collapsed comment as single (not group)', () => {
    // 連続 1 件だけだと "N 件の低評価" は煩いので single のまま出す
    const items = [
      { id: 'a', collapsed: false },
      { id: 'b', collapsed: true },
      { id: 'c', collapsed: false },
    ];
    const out = groupConsecutiveCollapsed(items);
    expect(out).toHaveLength(3);
    expect(out.map((x) => x.kind)).toEqual(['single', 'single', 'single']);
  });

  it('groups 2+ consecutive collapsed comments', () => {
    const items = [
      { id: 'a', collapsed: false },
      { id: 'b', collapsed: true },
      { id: 'c', collapsed: true },
      { id: 'd', collapsed: false },
    ];
    const out = groupConsecutiveCollapsed(items);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ kind: 'single', comment: items[0] });
    expect(out[1]).toMatchObject({ kind: 'group', count: 2 });
    if (out[1]!.kind === 'group') {
      expect(out[1]!.comments.map((c) => c.id)).toEqual(['b', 'c']);
    }
    expect(out[2]).toEqual({ kind: 'single', comment: items[3] });
  });

  it('handles multiple disjoint groups', () => {
    const items = [
      { id: 'a', collapsed: true },
      { id: 'b', collapsed: true },
      { id: 'c', collapsed: false },
      { id: 'd', collapsed: true },
      { id: 'e', collapsed: true },
      { id: 'f', collapsed: true },
    ];
    const out = groupConsecutiveCollapsed(items);
    expect(out).toHaveLength(3);
    expect(out[0]!.kind).toBe('group');
    if (out[0]!.kind === 'group') expect(out[0]!.count).toBe(2);
    expect(out[1]!.kind).toBe('single');
    expect(out[2]!.kind).toBe('group');
    if (out[2]!.kind === 'group') expect(out[2]!.count).toBe(3);
  });

  it('handles a run that ends the array', () => {
    const items = [
      { id: 'a', collapsed: false },
      { id: 'b', collapsed: true },
      { id: 'c', collapsed: true },
    ];
    const out = groupConsecutiveCollapsed(items);
    expect(out).toHaveLength(2);
    expect(out[1]!.kind).toBe('group');
  });

  it('does not mutate input array', () => {
    const items = [
      { id: 'a', collapsed: true },
      { id: 'b', collapsed: true },
    ];
    const snapshot = items.map((c) => ({ ...c }));
    groupConsecutiveCollapsed(items);
    expect(items).toEqual(snapshot);
  });
});

describe('annotateCollapsed', () => {
  it('adds collapsed: true/false to each input', () => {
    const items = [
      { id: 'good', likes_count: 5, concern_count: 0 },
      { id: 'bad', likes_count: 0, concern_count: 5 },
      { id: 'hidden', is_hidden_by_author: true },
    ];
    const out = annotateCollapsed(items);
    expect(out).toHaveLength(3);
    expect(out[0]!.collapsed).toBe(false);
    expect(out[1]!.collapsed).toBe(true);
    expect(out[2]!.collapsed).toBe(true);
  });

  it('does not mutate input array elements', () => {
    const items = [{ id: 'a', concern_count: 10 }];
    const before = JSON.stringify(items);
    annotateCollapsed(items);
    expect(JSON.stringify(items)).toBe(before);
  });
});
