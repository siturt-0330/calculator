// ============================================================
// lib/utils/communityModCheck.ts
// ============================================================
// pure な権限判定関数群。UI の表示制御 (mod 用ボタンを出すか / 隠すか) と
// クライアント側の事前バリデーションに使う。本番の権限担保は RLS + RPC 側に
// あるので、ここでバイパスできても DB が拒否する。
//
// 設計:
//   - 一切 supabase 依存を持たない (test 可能 + tree shake 可能)
//   - 入力は narrow な shape (Post / User) のみ受け取る
//   - role hierarchy: owner > admin > member
//     - admin は member を kick/ban 可
//     - admin は owner を kick/ban 不可
//     - owner は admin / member を kick/ban 可
//     - owner は自分を kick/ban 不可 (これは呼び出し側で別途チェック想定)
// ============================================================

export type Role = 'owner' | 'admin' | 'member';

// mod = owner or admin。role が null/undefined / 想定外文字列なら false。
export function isModRole(role: string | null | undefined): boolean {
  if (role !== 'owner' && role !== 'admin') return false;
  return true;
}

// owner > admin > member の数値表現 (大きいほど強い)。
// 想定外文字列は member 扱い (= 0)。
export function roleRank(role: Role | string | null | undefined): number {
  if (role === 'owner') return 2;
  if (role === 'admin') return 1;
  if (role === 'member') return 0;
  return 0;
}

// 投稿削除権限の判定:
//   - 投稿者本人なら常に削除可
//   - 投稿が属する community のいずれかで mod なら削除可
// post.community_ids は post_communities から逆引きしたものを渡す想定。
export function canDeletePost(
  post: { author_id: string; community_ids: string[] },
  currentUser: { id: string; modCommunities: string[] },
): boolean {
  if (!currentUser.id) return false;
  if (post.author_id === currentUser.id) return true;

  // 自分が mod の community と post の attached community に交差があれば mod 削除可
  const modSet = new Set(currentUser.modCommunities);
  for (const cid of post.community_ids) {
    if (modSet.has(cid)) return true;
  }
  return false;
}

// コメント削除権限の判定:
//   - 自著なら削除可
//   - コメントが付いている post の community のいずれかで mod なら削除可
export function canDeleteComment(
  comment: { author_id: string; post_community_ids: string[] },
  currentUser: { id: string; modCommunities: string[] },
): boolean {
  if (!currentUser.id) return false;
  if (comment.author_id === currentUser.id) return true;

  const modSet = new Set(currentUser.modCommunities);
  for (const cid of comment.post_community_ids) {
    if (modSet.has(cid)) return true;
  }
  return false;
}

// BBS 返信削除権限の判定:
//   - 自著なら削除可
//   - thread.community_id が非 null かつ自分がその community の mod なら削除可
//   - thread.community_id が null (全体スレ) なら mod 経路なし
export function canDeleteBBSReply(
  reply: { author_id: string; thread_community_id: string | null },
  currentUser: { id: string; modCommunities: string[] },
): boolean {
  if (!currentUser.id) return false;
  if (reply.author_id === currentUser.id) return true;
  if (!reply.thread_community_id) return false;

  return currentUser.modCommunities.includes(reply.thread_community_id);
}

// メンバー削除 (kick) 権限:
//   - 自分が mod (owner or admin)
//   - かつ target の role が自分より strictly 弱い (rank 比較)
//   - 自分自身は kick できない (両 role が等しいので rank 比較で false になる)
// actor / target が想定外文字列の場合: actor は member 扱い、target は member 扱い
// → admin が想定外 role を kick することは出来ないと判定する (安全側)。
export function canKickMember(
  actor: Role | string | null | undefined,
  target: Role | string | null | undefined,
): boolean {
  if (!isModRole(actor)) return false;
  return roleRank(actor) > roleRank(target);
}

// BAN 権限の判定。基本的には kick と同じ規則。
// 別関数として export しているのは将来「owner だけが BAN 可」等の拡張余地のため。
export function canBanMember(
  actor: Role | string | null | undefined,
  target: Role | string | null | undefined,
): boolean {
  return canKickMember(actor, target);
}
