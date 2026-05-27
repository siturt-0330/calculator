// ============================================================
// useCommentConcernToggle — comment_concerns (migration 0063) の toggle hook
// ------------------------------------------------------------
// 仕様:
//   - useMutation で wrap し、楽観 update + onError で revert
//   - 即時反映する対象 cache:
//       1) ['my-comment-concerns', postId] — Set<commentId>
//       2) ['post-comments', postId]       — comments[].concern_count
//   - onError で toast 表示 (失敗を user に伝える)
//
// 設計判断:
//   - 連打吸収の smart-queue は useLike/useConcern と違い、ここでは
//     一旦シンプルに実装する。コメント単位の concern は post 級と違い
//     連打されるシナリオが想定しづらいため (1 user 1 comment 1 回が standard)。
//   - cache key は post 単位の Set<commentId> を 1 件で保持 → 楽観 toggle が
//     軽量。複数 post を跨ぐ汎用 cache は持たない (use site が post detail のみ)。
// ============================================================

import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toggleCommentConcern } from '../lib/api/commentConcerns';
import { useToastStore } from '../stores/toastStore';
import type { Comment } from '../types/models';

type ToggleArgs = {
  commentId: string;
  // post 単位 cache 更新のため。 [post-comments, postId] / [my-comment-concerns, postId]
  // を patch する。
  postId: string;
};

type RollbackCtx = {
  prevSet: Set<string> | undefined;
  prevComments: Comment[] | undefined;
  // 最終状態 (UI への toast 出し分け用) — true = 新たに concern を付けた
  added: boolean;
};

export function useCommentConcernToggle() {
  const qc = useQueryClient();
  // toast actions は不変なので selector で薄く購読
  const show = useToastStore((s) => s.show);

  const mutation = useMutation<void, Error, ToggleArgs, RollbackCtx>({
    mutationFn: ({ commentId }) => toggleCommentConcern(commentId),

    // 楽観 update — server を叩く前に local cache を toggle する。
    onMutate: async ({ commentId, postId }) => {
      // refetch が optimistic を上書きする現象を防ぐため cancel 待ち
      await Promise.all([
        qc.cancelQueries({ queryKey: ['my-comment-concerns', postId] }).catch(() => {}),
        qc.cancelQueries({ queryKey: ['post-comments', postId] }).catch(() => {}),
      ]);

      // 1) my-comment-concerns: Set<commentId> を toggle
      const prevSet = qc.getQueryData<Set<string>>(['my-comment-concerns', postId]);
      const nextSet = new Set(prevSet ?? []);
      const wasConcerned = nextSet.has(commentId);
      if (wasConcerned) nextSet.delete(commentId);
      else nextSet.add(commentId);
      qc.setQueryData(['my-comment-concerns', postId], nextSet);

      // 2) post-comments: 該当 comment の concern_count を +/- 1
      const prevComments = qc.getQueryData<Comment[]>(['post-comments', postId]);
      if (prevComments) {
        const nextComments = prevComments.map((c) => {
          if (c.id !== commentId) return c;
          const cur = (c as Comment & { concern_count?: number }).concern_count ?? 0;
          const next = wasConcerned ? Math.max(0, cur - 1) : cur + 1;
          return { ...c, concern_count: next } as Comment;
        });
        qc.setQueryData(['post-comments', postId], nextComments);
      }

      return { prevSet, prevComments, added: !wasConcerned };
    },

    onError: (e, { postId }, ctx) => {
      // 楽観 update を巻き戻す
      if (ctx) {
        qc.setQueryData(['my-comment-concerns', postId], ctx.prevSet);
        if (ctx.prevComments) {
          qc.setQueryData(['post-comments', postId], ctx.prevComments);
        }
      }
      const msg = e instanceof Error ? e.message : '';
      show(msg ? `気になるの更新に失敗しました: ${msg}` : '気になるの更新に失敗しました', 'error');
    },

    onSuccess: (_d, _v, ctx) => {
      // toast: 何が起きたかをユーザーへ feedback
      if (ctx?.added) {
        show('コメントを「気になる」マークしました', 'info');
      } else {
        show('「気になる」を取り消しました', 'info');
      }
    },

    onSettled: (_d, _e, { postId }) => {
      // server 真値で最終的に再 sync。stale → 最新へ。
      qc.invalidateQueries({ queryKey: ['my-comment-concerns', postId] });
      qc.invalidateQueries({ queryKey: ['post-comments', postId] });
    },
  });

  const toggle = useCallback(
    (commentId: string, postId: string) => {
      mutation.mutate({ commentId, postId });
    },
    [mutation],
  );

  return { toggle, isPending: mutation.isPending };
}
