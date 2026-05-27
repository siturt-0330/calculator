// ============================================================
// コメントスコア表示遅延 (Hivemind 抑制)
// ------------------------------------------------------------
// 仕組み:
//   - コメントの likes_count を投稿直後 30 分間は数値で表示しない
//   - 5 分未満: '-' (まったく表示しない)
//   - 5-30 分: 1 件以上なら '数件' / 0 件なら '-'
//   - 30 分以降: 通常の数値を文字列化
// 狙い:
//   - 「いいね数を見て同調する」Hivemind 現象を初期段階で抑える
//   - 一定時間経過後は通常の数値表示に戻す
//
// 注意:
//   - post 自体の likes_count には適用しない (フィードカード等)
//     → 本 helper はコメントの likes 用に呼び出し側で限定する
//   - 純関数 (引数 + 任意の nowMs のみ依存) → unit test 容易
// ============================================================

const FIVE_MIN_MS = 5 * 60 * 1000;
const THIRTY_MIN_MS = 30 * 60 * 1000;

/**
 * コメントの likes_count をどう表示するかを返す。
 *
 * @param createdAt コメント投稿時刻 (ISO 文字列 or epoch ms)
 * @param likesCount いいね数 (null / undefined は 0 扱い)
 * @param nowMs テスト用の現在時刻 override (省略時は Date.now())
 * @returns 表示文字列 ('-' / '数件' / '12' など)
 */
export function getDisplayCommentLikes(
  createdAt: string | number | null | undefined,
  likesCount: number | null | undefined,
  nowMs: number = Date.now(),
): string {
  // 不正値 (createdAt が parse 不能) の場合は安全側で数値表示を返す
  // → コメントが表示されない事故を避ける
  const created =
    typeof createdAt === 'number'
      ? createdAt
      : typeof createdAt === 'string'
        ? Date.parse(createdAt)
        : NaN;

  const likes = typeof likesCount === 'number' && Number.isFinite(likesCount)
    ? Math.max(0, Math.floor(likesCount))
    : 0;

  if (!Number.isFinite(created)) {
    // created_at 不正 → そのまま数値表示にフォールバック
    return String(likes);
  }

  const ageMs = nowMs - created;

  // 未来時刻 (clock skew) は通常表示扱い
  if (ageMs < 0) return String(likes);

  if (ageMs < FIVE_MIN_MS) {
    return '-';
  }
  if (ageMs < THIRTY_MIN_MS) {
    return likes >= 1 ? '数件' : '-';
  }
  return String(likes);
}
