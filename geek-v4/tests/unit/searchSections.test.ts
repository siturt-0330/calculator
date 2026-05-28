// ============================================================
// searchSections.test.ts — buildSearchSections() の振る舞いを固定する
// ------------------------------------------------------------
// カバレッジ:
//   - 完全に空入力 → 空配列
//   - 1 セクションだけヒット
//   - 5 セクション全ヒット (順序 / titles)
//   - topN による切り出し
//   - topN === 0 (全件 preview)
//   - overflow / hasMore の計算
//   - 空セクションは含まれない
//   - undefined 入力フィールド
//   - topN > items.length のとき previewItems = items
//   - 非整数 / 負数 / Infinity は 0 として扱う (clamp)
// ============================================================
import {
  buildSearchSections,
  totalResultCount,
  sectionOrder,
  sectionTitle,
} from '../../lib/utils/searchSections';

describe('searchSections', () => {
  describe('buildSearchSections', () => {
    it('returns empty array for fully empty input', () => {
      expect(buildSearchSections({})).toEqual([]);
    });

    it('returns empty array when every section is empty arrays', () => {
      expect(
        buildSearchSections({
          posts: [],
          bbsThreads: [],
          communities: [],
          tags: [],
          users: [],
        }),
      ).toEqual([]);
    });

    it('returns one section when only posts has hits', () => {
      const sections = buildSearchSections({ posts: [{ id: 'p1' }, { id: 'p2' }] }, 3);
      expect(sections).toHaveLength(1);
      const first = sections[0]!;
      expect(first.kind).toBe('posts');
      expect(first.title).toBe('投稿');
      expect(first.count).toBe(2);
      expect(first.previewItems).toHaveLength(2);
      expect(first.hasMore).toBe(false);
      expect(first.overflow).toBe(0);
    });

    it('preserves section order: posts → bbs → communities → tags → users', () => {
      const sections = buildSearchSections(
        {
          users: [{ id: 'u' }],
          tags: [{ name: 't' }],
          communities: [{ id: 'c' }],
          bbsThreads: [{ id: 'b' }],
          posts: [{ id: 'p' }],
        },
        3,
      );
      expect(sections.map((s) => s.kind)).toEqual([
        'posts',
        'bbs',
        'communities',
        'tags',
        'users',
      ]);
    });

    it('slices to topN per section and reports overflow', () => {
      const posts = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}` }));
      const sections = buildSearchSections({ posts }, 3);
      const s = sections[0]!;
      expect(s.previewItems).toHaveLength(3);
      expect(s.items).toHaveLength(10);
      expect(s.count).toBe(10);
      expect(s.hasMore).toBe(true);
      expect(s.overflow).toBe(7);
    });

    it('returns all items when topN === 0 (preview-off mode)', () => {
      const posts = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}` }));
      const sections = buildSearchSections({ posts }, 0);
      const s = sections[0]!;
      expect(s.previewItems).toHaveLength(5);
      expect(s.previewItems).toEqual(s.items);
      expect(s.hasMore).toBe(false);
      expect(s.overflow).toBe(0);
    });

    it('previewItems === items when topN > items.length', () => {
      const sections = buildSearchSections({ tags: [{ name: 'a' }, { name: 'b' }] }, 99);
      const s = sections[0]!;
      expect(s.previewItems).toHaveLength(2);
      expect(s.hasMore).toBe(false);
      expect(s.overflow).toBe(0);
    });

    it('clamps invalid topN (negative / NaN / Infinity) to 0 → all items preview', () => {
      const posts = [{ id: 'p1' }, { id: 'p2' }];
      // 負数
      expect(buildSearchSections({ posts }, -3)[0]!.previewItems).toHaveLength(2);
      // NaN
      expect(buildSearchSections({ posts }, Number.NaN)[0]!.previewItems).toHaveLength(2);
      // Infinity
      expect(buildSearchSections({ posts }, Number.POSITIVE_INFINITY)[0]!.previewItems).toHaveLength(2);
    });

    it('omits sections whose data is undefined', () => {
      const sections = buildSearchSections({ posts: [{ id: 'p1' }] });
      expect(sections).toHaveLength(1);
      expect(sections[0]!.kind).toBe('posts');
    });

    it('does not mutate the input arrays', () => {
      const posts = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }];
      const snapshot = [...posts];
      buildSearchSections({ posts }, 2);
      expect(posts).toEqual(snapshot);
    });

    it('default topN === 3', () => {
      const posts = [
        { id: 'p1' },
        { id: 'p2' },
        { id: 'p3' },
        { id: 'p4' },
        { id: 'p5' },
      ];
      const sections = buildSearchSections({ posts });
      const s = sections[0]!;
      expect(s.previewItems).toHaveLength(3);
      expect(s.overflow).toBe(2);
    });
  });

  describe('totalResultCount', () => {
    it('sums all sections including missing ones', () => {
      expect(
        totalResultCount({
          posts: [{ id: 1 }, { id: 2 }],
          bbsThreads: [{ id: 3 }],
          communities: [],
          tags: [{ name: 't' }],
          // users is undefined
        }),
      ).toBe(4);
    });

    it('returns 0 for fully empty', () => {
      expect(totalResultCount({})).toBe(0);
    });
  });

  describe('sectionTitle / sectionOrder', () => {
    it('exposes section order in spec order', () => {
      expect(sectionOrder()).toEqual(['posts', 'bbs', 'communities', 'tags', 'users']);
    });

    it('returns Japanese title per kind', () => {
      expect(sectionTitle('posts')).toBe('投稿');
      expect(sectionTitle('bbs')).toBe('掲示板');
      expect(sectionTitle('communities')).toBe('コミュ');
      expect(sectionTitle('tags')).toBe('タグ');
      expect(sectionTitle('users')).toBe('ユーザー');
    });
  });
});
