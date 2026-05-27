// ============================================================
// qaSort — Q&A モード (post-level) 用 comment sorter (pure helper)
// ------------------------------------------------------------
// Reddit ガイド #17 (4.6 / 5.4 章) — post の author が Q&A モードを enable
// したときに、コメント sort を「author が返信したコメントを優先」に切り替える。
// アイドル / 専門家の AMA 用途。
//
// 並び規則 (上から順):
//   tier 0: author が返信したスレッド (= ある root の派生 children に
//           author_id を持つ comment が 1 つでもある場合)
//   tier 1: author 自身が書いた root コメント (author が直接 root を投稿した)
//   tier 2: それ以外 (時系列で新しい順)
//
// 同点 (= 同 tier) の comment は created_at 降順 (新しい順) で並べる。
//
// 既存の commentTree (= 入力は build 済の Comment[] with children) を
// そのまま受け取り、root の並びだけを変える契約。children の並びは触らない
// (= UI 側で「親→子→孫」展開時には時系列のままで読みやすさを保つ)。
//
// 副作用ゼロ。supabase / RN を import しないので Jest で素のまま動く。
// ============================================================

import type { Comment } from '../../types/models';

/**
 * 与えた comment の children を再帰的に walk して、authorId に一致する
 * author の発言 (comment.author_id) が含まれるかを判定する。
 *
 * 注意: Comment 型に author_id は明示存在しないが (匿名運用)、
 *       Q&A モードでは投稿者の発言を判別するため、buildCommentTree が
 *       上位 fetch から author_id を保持している前提で読み出す
 *       (= 呼出側で attach 済み)。未設定なら一致しない扱い。
 *
 * cycle 防止: 同じ id を 2 回見たら無視する (visited set)。
 */
export function hasReplyFrom(comment: Comment, authorId: string): boolean {
  if (!authorId) return false;
  const visited = new Set<string>();
  function walk(node: Comment): boolean {
    if (visited.has(node.id)) return false;
    visited.add(node.id);
    const children = node.children ?? [];
    for (const child of children) {
      const childAuthorId = (child as Comment & { author_id?: string | null }).author_id;
      if (childAuthorId && childAuthorId === authorId) return true;
      if (walk(child)) return true;
    }
    return false;
  }
  return walk(comment);
}

/**
 * Q&A モード用 sorter。
 *
 * - postAuthorId が空文字 / undefined のときは作用させない (= 入力そのまま)
 * - 入力配列は変更しない (immutable)。新しい配列を返す。
 * - children の並びは保持する (= 親レベルだけ並び替え)
 */
export function sortCommentsForQAMode(
  comments: Comment[],
  postAuthorId: string,
): Comment[] {
  if (!postAuthorId) return comments.slice();
  if (comments.length === 0) return [];

  // tier を 1 度だけ計算してキャッシュ (再帰 walk を 2 回しない)
  type Decorated = { comment: Comment; tier: 0 | 1 | 2; createdMs: number };
  const decorated: Decorated[] = comments.map((c) => {
    const authorId = (c as Comment & { author_id?: string | null }).author_id;
    const isOwnRoot = !!authorId && authorId === postAuthorId;
    const hasOwnReply = hasReplyFrom(c, postAuthorId);
    // tier 0 が最優先 — author が「返信したスレッド」(= root 自身が author
    // でなくても、後から author が反応した時点で AMA の本筋になる)
    const tier: 0 | 1 | 2 = hasOwnReply ? 0 : isOwnRoot ? 1 : 2;
    const t = Date.parse(c.created_at);
    return {
      comment: c,
      tier,
      createdMs: Number.isFinite(t) ? t : 0,
    };
  });

  decorated.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    // 同 tier: created_at 降順 (新しい順) — tie-break
    return b.createdMs - a.createdMs;
  });

  return decorated.map((d) => d.comment);
}
