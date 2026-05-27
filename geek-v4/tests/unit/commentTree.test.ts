// ============================================================
// commentTree.test.ts — buildCommentTree / flattenCommentTree の unit test
// ------------------------------------------------------------
// migration 0059 で追加したコメントツリー構築 helper の純関数テスト。
// 副作用ゼロなので supabase / RN を一切 mock せずに動く。
// ============================================================

import {
  buildCommentTree,
  flattenCommentTree,
  COMMENT_MAX_DEPTH,
} from '../../lib/utils/commentTree';
import type { Comment } from '../../types/models';

// テスト fixture を 1 行で書けるヘルパ
let counter = 0;
function mk(
  id: string,
  parent: string | null = null,
  createdAt?: string,
): Comment {
  counter += 1;
  return {
    id,
    post_id: 'post-1',
    content: `content-${id}`,
    avatar_color: '#000',
    created_at: createdAt ?? `2026-05-27T12:00:${String(counter).padStart(2, '0')}Z`,
    parent_comment_id: parent,
    reply_to_comment_id: null,
  };
}

describe('buildCommentTree', () => {
  beforeEach(() => {
    counter = 0;
  });

  it('returns [] for empty input', () => {
    expect(buildCommentTree([])).toEqual([]);
  });

  it('treats parent_comment_id NULL as root', () => {
    const flat = [mk('a'), mk('b'), mk('c')];
    const tree = buildCommentTree(flat);
    expect(tree).toHaveLength(3);
    expect(tree.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    for (const n of tree) {
      expect(n.depth).toBe(0);
      expect(n.children).toEqual([]);
    }
  });

  it('attaches children to their parent', () => {
    const flat = [
      mk('root1'),
      mk('child1', 'root1'),
      mk('child2', 'root1'),
      mk('root2'),
    ];
    const tree = buildCommentTree(flat);
    expect(tree).toHaveLength(2);
    expect(tree.map((n) => n.id)).toEqual(['root1', 'root2']);
    const root1 = tree[0]!;
    expect(root1.children).toHaveLength(2);
    expect(root1.children!.map((c) => c.id)).toEqual(['child1', 'child2']);
    expect(root1.children![0]!.depth).toBe(1);
    expect(root1.children![1]!.depth).toBe(1);
  });

  it('computes depth recursively up to MAX_DEPTH', () => {
    // root → d1 → d2 → d3 (= depth 0..3, all within MAX_DEPTH=3)
    const flat = [
      mk('root'),
      mk('d1', 'root'),
      mk('d2', 'd1'),
      mk('d3', 'd2'),
    ];
    const tree = buildCommentTree(flat);
    expect(tree).toHaveLength(1);
    const root = tree[0]!;
    expect(root.depth).toBe(0);
    const d1 = root.children![0]!;
    expect(d1.depth).toBe(1);
    const d2 = d1.children![0]!;
    expect(d2.depth).toBe(2);
    const d3 = d2.children![0]!;
    expect(d3.depth).toBe(COMMENT_MAX_DEPTH); // = 3
  });

  it('flattens depth > MAX_DEPTH to root (client-side safety net)', () => {
    // DB trigger が parent を nullify しないケース (例: server bug の保険)
    // d4 を意図的に深く繋いだ場合、client 側で root に持ち上がる
    const flat = [
      mk('root'),
      mk('d1', 'root'),
      mk('d2', 'd1'),
      mk('d3', 'd2'),
      mk('d4', 'd3'),   // depth 4 になりかける = client で root 化
    ];
    const tree = buildCommentTree(flat);
    // root 直下に d4 が flatten される
    const allRootIds = tree.map((n) => n.id);
    expect(allRootIds).toContain('root');
    expect(allRootIds).toContain('d4');
    // d4 の depth は 0 に clamp
    const d4 = tree.find((n) => n.id === 'd4');
    expect(d4?.depth).toBe(0);
  });

  it('rescues orphans (parent not found) as root', () => {
    const flat = [
      mk('a'),
      mk('orphan', 'deleted-parent-id'),
    ];
    const tree = buildCommentTree(flat);
    expect(tree.map((n) => n.id).sort()).toEqual(['a', 'orphan']);
    const orphan = tree.find((n) => n.id === 'orphan')!;
    expect(orphan.depth).toBe(0);
  });

  it('sorts children by created_at ascending (oldest first)', () => {
    const flat = [
      mk('r'),
      mk('z', 'r', '2026-05-27T13:00:00Z'),  // 後
      mk('a', 'r', '2026-05-27T12:00:00Z'),  // 先
      mk('m', 'r', '2026-05-27T12:30:00Z'),  // 中
    ];
    const tree = buildCommentTree(flat);
    const root = tree[0]!;
    expect(root.children!.map((c) => c.id)).toEqual(['a', 'm', 'z']);
  });

  it('sorts roots by created_at ascending', () => {
    const flat = [
      mk('z', null, '2026-05-27T13:00:00Z'),
      mk('a', null, '2026-05-27T12:00:00Z'),
      mk('m', null, '2026-05-27T12:30:00Z'),
    ];
    const tree = buildCommentTree(flat);
    expect(tree.map((n) => n.id)).toEqual(['a', 'm', 'z']);
  });

  it('does not mutate input array or element objects', () => {
    const flat = [mk('a'), mk('b', 'a')];
    const snapshotA = { ...flat[0]! };
    const snapshotB = { ...flat[1]! };
    buildCommentTree(flat);
    expect(flat[0]).toEqual(snapshotA);
    expect(flat[1]).toEqual(snapshotB);
    // children は元 element には付かない
    expect((flat[0] as Comment).children).toBeUndefined();
  });

  it('handles cycle gracefully (a → b → a)', () => {
    // 通常 DB trigger で防がれるが、誤データに対する保険
    const flat: Comment[] = [
      { ...mk('a'), parent_comment_id: 'b' },
      { ...mk('b'), parent_comment_id: 'a' },
    ];
    // どちらも親があるが循環 → どちらかが root に救済され無限ループしない
    const tree = buildCommentTree(flat);
    // 仕様: 親が存在するなら参照されるので、a→b と b→a の両者は
    // 互いの children に入る (循環参照)。 visited set で BFS は止まる。
    // 厳密に root が 0 件になっても 「無限ループ せず終了する」 ことが本テストの主旨。
    expect(Array.isArray(tree)).toBe(true);
  });

  it('preserves trust_score and other fields on cloned nodes', () => {
    const c: Comment = {
      ...mk('a'),
      trust_score: 75,
      reply_to_comment_id: 'someone-else',
    };
    const tree = buildCommentTree([c]);
    expect(tree[0]!.trust_score).toBe(75);
    expect(tree[0]!.reply_to_comment_id).toBe('someone-else');
  });
});

describe('flattenCommentTree (pre-order traversal)', () => {
  beforeEach(() => {
    counter = 0;
  });

  it('returns DFS order with depth set per node', () => {
    // tree:
    //   r1 (depth 0)
    //     a (depth 1)
    //       a1 (depth 2)
    //     b (depth 1) -- a の sibling = depth 1
    //   r2 (depth 0)
    const flat = [
      mk('r1', null, '2026-05-27T12:00:00Z'),
      mk('a', 'r1', '2026-05-27T12:01:00Z'),
      mk('a1', 'a', '2026-05-27T12:02:00Z'),
      mk('b', 'r1', '2026-05-27T12:03:00Z'),
      mk('r2', null, '2026-05-27T12:04:00Z'),
    ];
    const tree = buildCommentTree(flat);
    const flatOut = flattenCommentTree(tree);
    expect(flatOut.map((n) => n.id)).toEqual(['r1', 'a', 'a1', 'b', 'r2']);
    expect(flatOut.map((n) => n.depth)).toEqual([0, 1, 2, 1, 0]);
  });

  it('clears children on flattened output', () => {
    const flat = [mk('r'), mk('c', 'r')];
    const tree = buildCommentTree(flat);
    const flatOut = flattenCommentTree(tree);
    for (const n of flatOut) {
      expect(n.children).toBeUndefined();
    }
  });
});
