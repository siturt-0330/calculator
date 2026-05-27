// ============================================================
// commentTree — flat な Comment[] → 階層ツリー (pure helper)
// ------------------------------------------------------------
// migration 0059 で comments.parent_comment_id を追加した。サーバーは
// flat にしか返さないので、UI 側でツリー組み立てするのがこの helper。
//
// 仕様:
//   - parent_comment_id = NULL は ルート (depth=0)
//   - 親が見つからない comment は ルート扱いで救済 (孤児防止)
//   - DB trigger で 5 階層目以降は parent NULL に矯正されるため、ここでも
//     depth は 0..3 の 4 段までに clamp する (= MAX_DEPTH=3)
//   - 子のソートは created_at 昇順 (= 古い順) 固定。
//     "Best" ソートはルートのみ呼出側で適用する想定。
//
// 副作用なし — 引数の配列も element も mutate しない (children と depth を
// 持った新オブジェクトを返す)。
//
// import 形式は CommentTreeNode = Comment + children/depth (= Comment 型に
// 元々 optional で children / depth が宣言されている)。
// ============================================================

import type { Comment } from '../../types/models';

export const COMMENT_MAX_DEPTH = 3;

// 内部で使う mutable な node 表現 (再代入可)
type TreeNode = Comment & { children: Comment[]; depth: number };

/**
 * flat な Comment 配列をツリー化する。
 *
 * - root は parent_comment_id が NULL の comment
 * - 各 node の children には直接の子の配列が入る
 * - depth は 0..COMMENT_MAX_DEPTH (=3) に clamp される
 * - 親 id が flat に存在しない comment は root に救済される
 * - root / children のいずれも created_at 昇順 (古い順) で並ぶ
 */
export function buildCommentTree(flat: readonly Comment[]): Comment[] {
  if (!flat || flat.length === 0) return [];

  // 1. id → 新 node の map (mutate 用なので clone してから入れる)
  const byId = new Map<string, TreeNode>();
  for (const c of flat) {
    byId.set(c.id, {
      ...c,
      children: [],
      depth: 0,
    });
  }

  // 2. parent を辿って children を組み立てる
  //    parent が見つからない (削除済 / 別 post など) ものは root に救済
  const roots: TreeNode[] = [];
  for (const c of flat) {
    const node = byId.get(c.id);
    if (!node) continue;
    const parentId = c.parent_comment_id ?? null;
    if (!parentId) {
      roots.push(node);
      continue;
    }
    const parent = byId.get(parentId);
    if (!parent) {
      // 孤児 = root に救済 (UI で消えるよりはマシ)
      roots.push(node);
      continue;
    }
    parent.children.push(node);
  }

  // 3. depth を BFS で確定 (cycle 防止に visited set 併用)
  //    DB trigger で深さは 4 段までに矯正されているが、念のため client 側も
  //    COMMENT_MAX_DEPTH で clamp する。clamp は parent の depth を見て、
  //    自分が MAX を超えるなら親を root 直下に持ち上げる (flatten)。
  const visited = new Set<string>();
  const queue: TreeNode[] = [];
  for (const r of roots) {
    r.depth = 0;
    queue.push(r);
    visited.add(r.id);
  }
  while (queue.length > 0) {
    const cur = queue.shift();
    if (!cur) continue;
    // 子は created_at 昇順で並べる (in-place sort で OK — TreeNode は新オブジェクト)
    cur.children.sort((a, b) => {
      const ta = Date.parse(a.created_at);
      const tb = Date.parse(b.created_at);
      return (Number.isFinite(ta) ? ta : 0) - (Number.isFinite(tb) ? tb : 0);
    });
    for (const child of cur.children) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      const childNode = child as TreeNode;
      if (cur.depth >= COMMENT_MAX_DEPTH) {
        // 深さ超過 → root に flatten (DB 矯正の補助)
        childNode.depth = 0;
        roots.push(childNode);
        // 親の children から外す: 既に push 済みなので、見かけ上は
        // 「children のリストに残るが render side で depth=0 が root 化」する。
        // ここでは厳密に外しておく (UI 表示の重複を避ける)。
        cur.children = cur.children.filter((c) => c.id !== childNode.id);
        queue.push(childNode);
      } else {
        childNode.depth = cur.depth + 1;
        queue.push(childNode);
      }
    }
  }

  // 4. root も created_at 昇順
  roots.sort((a, b) => {
    const ta = Date.parse(a.created_at);
    const tb = Date.parse(b.created_at);
    return (Number.isFinite(ta) ? ta : 0) - (Number.isFinite(tb) ? tb : 0);
  });

  return roots;
}

// ============================================================
// tree → flat の逆変換 (FlashList が階層を理解しないので、
// depth 付きで pre-order traversal して flat 化する用の helper)
// ------------------------------------------------------------
// CommentThreadItem 側で再帰 render する場合は使わなくて良いが、
// 「FlashList で 1 階層リスト + 各 row が indent で深さ表現」も選べるよう
// export しておく。pre-order = root → child → grandchild の DFS 順。
// ============================================================
export function flattenCommentTree(tree: readonly Comment[]): Comment[] {
  const out: Comment[] = [];
  const visit = (nodes: readonly Comment[], depth: number) => {
    for (const n of nodes) {
      out.push({ ...n, depth, children: undefined });
      const kids = n.children;
      if (kids && kids.length > 0) {
        visit(kids, Math.min(COMMENT_MAX_DEPTH, depth + 1));
      }
    }
  };
  visit(tree, 0);
  return out;
}
