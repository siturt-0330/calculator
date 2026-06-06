// ============================================================
// Vote Fuzzing — 表示する likes 数に決定的 noise を加える
// ============================================================
//
// 目的:
//   スパマー / sock puppet が「+1 で何が起きるか」「自分の自演で
//   どの順序で並ぶか」を観測しにくくする。表示値に少量のノイズが
//   常に乗ることで、1 票単位の挙動が読めなくなる。
//
// 重要:
//   - ノイズは **表示用のみ**。実 score / ranking / 並び替えは
//     ノイズ無し real_likes ベースで動く。
//   - 同じ post_id なら fuzz は **常に同じ整数** (deterministic)。
//     再 render しても表示が揺らがない。
//
// アルゴリズム:
//   - FNV-1a 32-bit hash (threadUserId.ts と同じ高速 / 同期 hash)
//   - hash(post_id) % 11 → 0..10 → -5..+5 の整数
//
// レンジ調整:
//   - real_likes <= 2: ノイズ off。少数票 (0,1,2) で「-3」とか出ると
//     表示が負数になったり UX が壊れる。
//   - real_likes <= 10: fuzz は ±1 のみ。10 票で「+5」だと割合的に
//     違和感が大きい。
//   - real_likes > 10: fuzz は -5..+5 のフルレンジ。
//
// 適用箇所:
//   - AnonPostCard の likes 表示部分 (ハートアイコン右の数字)
//   - 他箇所 (詳細ページの集計 / mypage の合計 / DB) は touch しない。
// ============================================================

const FNV_OFFSET = 2166136261; // 32-bit FNV-1a offset basis
const FNV_PRIME = 16777619; // 32-bit FNV-1a prime

/**
 * FNV-1a 32-bit hash. threadUserId.ts と同じ実装。
 *
 * @internal export しているのは test の便宜のみ。production code は
 *           getDisplayLikes / getVoteFuzz だけを呼ぶ。
 */
export function fnv1a32(input: string): number {
  let h = FNV_OFFSET >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // Math.imul は 32-bit 整数乗算 (通常の `*` は double 経由で精度落ち)
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h >>> 0;
}

/**
 * post_id ベースの決定的 fuzz 整数を計算する。
 *
 * @param postId 投稿 ID
 * @param realLikes 真の likes 数 (DB の値)
 * @returns -5..+5 の整数。real_likes が小さいときは絞ったレンジ。
 */
export function getVoteFuzz(postId: string, realLikes: number): number {
  // 少数票はそのまま — 0/1/2 で揺らすと UI が壊れる (負数表示 / "+5" 違和感)
  if (realLikes <= 2) return 0;

  // hash → 0..10
  const raw = fnv1a32(postId) % 11;
  // 0..10 → -5..+5
  const full = raw - 5;

  // 中規模 (3..10) は ±1 に絞る — 10 票で +5 だと印象が大きく動きすぎる
  if (realLikes <= 10) {
    if (full > 0) return 1;
    if (full < 0) return -1;
    return 0;
  }

  return full;
}

/**
 * 表示用 likes 数を返す。
 *
 * UI でハートアイコン横の数字を出すときに使う。real_likes をそのまま
 * 出すのではなく、この関数を経由することで spammer に対する観測耐性
 * を得る。
 *
 * @param postId 投稿 ID (fuzz の seed)
 * @param realLikes DB の likes_count
 * @returns 表示用 likes 数 (常に >= 0 を保証)
 */
export function getDisplayLikes(postId: string, realLikes: number): number {
  // 念のため負数 / NaN / 非整数を弾く
  const r = Math.max(0, Math.floor(realLikes || 0));
  const fuzz = getVoteFuzz(postId, r);
  const display = r + fuzz;
  // post_id 不一致やバグで負になっても 0 にクランプ
  return display < 0 ? 0 : display;
}

/**
 * 閲覧者の self-like を fuzz から切り離した表示用 likes 数。
 *
 * 【背景 = "いいね押しても数が反映されない" バグ】
 *   getDisplayLikes は real_likes 全体に fuzz をかける。閲覧者自身が like /
 *   unlike すると real_likes が ±1 するが、その値が fuzz の tier 境界
 *   (2↔3 / 10↔11) を跨ぐと fuzz の大きさ自体が変わり、表示が ±1 にならない。
 *   例: real 10 (fuzz ±1 帯) → 11 (fuzz ±5 帯) で、表示が 11 → 11 のまま動かず、
 *   ハートは点くのに数字が増えない → 「反映されない」と感じる。
 *
 * 【対策】
 *   fuzz は「自分を除いた票数 (others)」に対して計算する。others は閲覧者が
 *   toggle しても不変 (real_likes と self が同時に ±1 するため相殺) なので fuzz が
 *   安定する。そこへ自分の like を素の +1 として上乗せすることで、自分の操作は
 *   必ず ±1 で表示に反映される。他人票に対する観測耐性 (spammer 対策) は維持。
 *
 * @param postId 投稿 ID (fuzz の seed)
 * @param realLikes DB の likes_count (自分の like を含む)
 * @param viewerLiked 閲覧者がこの投稿を like 済みか
 * @returns 表示用 likes 数 (常に >= 0)
 */
export function getDisplayLikesForViewer(
  postId: string,
  realLikes: number,
  viewerLiked: boolean,
): number {
  const r = Math.max(0, Math.floor(realLikes || 0));
  const mine = viewerLiked ? 1 : 0;
  const others = Math.max(0, r - mine);
  return getDisplayLikes(postId, others) + mine;
}
