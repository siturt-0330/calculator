// ============================================================
// BBS スレ内 ID (2ch 風) — スレッド内で同一投稿者を識別する短い ID
// ============================================================
//
// 設計:
//   - 同じ user_id + thread_id なら **常に同じ ID** (deterministic)
//   - 別スレでは別 ID = 匿名性を保ちつつスレ内ではキャラとして見える
//   - 計算は client-side のみ (DB 変更不要 / migration 不要)
//
// アルゴリズム: FNV-1a 32-bit hash → base36 6 文字
//   - 衝突空間: 36^6 ≒ 2.17B 通り
//   - スレ内に 1000 ユーザーいて全員違う ID になる確率: 99.99977% (実用上 OK)
//   - SHA-256 だと crypto.subtle が async で UI コード上扱いづらい
//     → FNV-1a を choose (高速 / 同期 / 衝突率は実用域)
//
// 注意:
//   - これは **表示用 ID** であり、秘密情報ではない (元 user_id は別途
//     クライアントに来ている / RLS bbs_replies_read で誰でも読める)
//   - 「匿名性の保護」というより 「スレ内で同じ人だと分かる UX」 のための仕組み
// ============================================================

const FNV_OFFSET = 2166136261; // 32-bit FNV-1a offset basis
const FNV_PRIME = 16777619; // 32-bit FNV-1a prime

/**
 * スレ内 ID を計算する。
 *
 * @param userId 投稿者の auth user_id (bbs_replies.author_id)
 * @param threadId 該当スレッドの id (bbs_threads.id)
 * @returns 6 文字の base36 ID (例: "a3b9f2")
 */
export function getThreadUserId(userId: string, threadId: string): string {
  // 区切り文字 (":") を入れて user_id と thread_id の境界を曖昧にしない
  // (連結だけだと "ab" + "cd" と "a" + "bcd" が同 ID になる)
  const seed = `${userId}:${threadId}`;
  let h = FNV_OFFSET >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    // Math.imul は 32-bit 整数乗算 (JS の通常乗算は double を経由するので
    // 大きな数で精度が落ちる)
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  // 32-bit unsigned を base36 にすると最大 6 文字 (例: "zik0zk")
  // 短いハッシュ値の場合は左 0 padding
  return h.toString(36).padStart(6, '0').slice(-6);
}
