// ============================================================
// commentBestScore — Reddit 風「Best」コメントソート (pure helper)
// ------------------------------------------------------------
// post 詳細のコメント並び替え用の純粋関数を分離。実装を lib/api/bbs.ts に
// 直接書くと supabase / react-native のインポートチェーンを引きずって
// Jest が parse error を出すので、helper は副作用ゼロのこの file に隔離する。
// lib/api/bbs.ts は `export { ... } from '../utils/commentBestScore'` で薄く
// 再エクスポートする (= 呼出 component は bbs.ts から import するだけで OK)。
//
// 計算: like_count + reply_count * 0.5 + 1 / (age_hours + 2)
//
//   - 現在 Comment 型に like_count / reply_count が無いので、引数も
//     optional として扱い未定義は 0 として計算 (= 全コメントが純粋に時間
//     boost 1/(h+2) で並ぶ = 「最近の方が上」)。
//   - 将来 schema に counter が乗れば自動で本来の Best 挙動になる。
//   - BBS replies (= bbs_replies) は対象外。2ch 風の時系列が体験上良いので
//     この helper は post 詳細のコメントだけで使う。
// ============================================================

export type CommentLike = {
  created_at: string;
  like_count?: number | null;
  reply_count?: number | null;
};

export function computeCommentBestScore(
  c: CommentLike,
  nowMs: number = Date.now(),
): number {
  const likes = Math.max(0, c.like_count ?? 0);
  const replies = Math.max(0, c.reply_count ?? 0);
  const createdAtMs = Date.parse(c.created_at);
  let timeBonus = 0;
  if (Number.isFinite(createdAtMs)) {
    const ageHours = Math.max(0, (nowMs - createdAtMs) / 3_600_000);
    timeBonus = 1 / (ageHours + 2);
  }
  return likes + replies * 0.5 + timeBonus;
}

export function sortCommentsByBest<T extends CommentLike>(
  comments: readonly T[],
  nowMs: number = Date.now(),
): T[] {
  // 新配列を作って sort (caller 側 react-query cache の immutability を保つ)
  return comments
    .slice()
    .sort((a, b) => computeCommentBestScore(b, nowMs) - computeCommentBestScore(a, nowMs));
}
