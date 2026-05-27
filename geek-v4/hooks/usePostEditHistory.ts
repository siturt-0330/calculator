// ============================================================
// usePostEditHistory — 投稿の編集履歴を lazy fetch する Hook
// ============================================================
// EditHistoryModal が開いた瞬間にだけ fetch する。閉じている時は
// network を一切叩かないので、フィード scroll 中の余計な負荷を回避。
//
// staleTime 60s:
//   - 編集履歴は trigger 経由でしか追加されないので、頻繁に更新される
//     データではない。60 秒キャッシュで modal を開閉した時の二重 fetch
//     を防ぐ (UX 体感: 同じ post の履歴を再度開いても瞬時に表示)。
// ============================================================

import { useQuery } from '@tanstack/react-query';
import { fetchPostEditHistory, type PostEdit } from '../lib/api/postEdits';

export const POST_EDIT_HISTORY_KEY = (postId: string) => ['post-edit-history', postId] as const;

/**
 * @param postId   履歴を取得する投稿 ID
 * @param enabled  modal が開いている時だけ true にする (lazy fetch)
 */
export function usePostEditHistory(postId: string, enabled: boolean) {
  return useQuery({
    queryKey: POST_EDIT_HISTORY_KEY(postId),
    queryFn: () => fetchPostEditHistory(postId),
    enabled: enabled && !!postId,
    staleTime: 60_000,
  });
}

export type { PostEdit };
