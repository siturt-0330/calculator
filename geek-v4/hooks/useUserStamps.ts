import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';
import { createUserStamp, deleteUserStamp, fetchUserStamps, type UserStamp } from '../lib/api/userStamps';

const KEY = ['user-stamps'];

// ============================================================
// useUserStamps
// ============================================================
// 旧構成: 個別 channel `user-stamps-feed` で creator_id=userId と
//         INSERT (no filter, heavy-throttle) を 2 binding で attach。
// 新構成 (Audit E#5): hooks/useUserChannel.ts の 1 channel に
//   `creator_id=eq.userId` フィルタの 1 binding に集約。
//   他人の公開 stamp INSERT は staleTime 60s + pull-to-refresh で取得 (realtime 不要)。
// ============================================================
export function useUserStamps() {
  const q = useQuery({
    queryKey: KEY,
    queryFn: fetchUserStamps,
    staleTime: 60_000,
  });

  return { stamps: (q.data ?? []) as UserStamp[], isLoading: q.isLoading };
}

// ============================================================
// useCreateUserStamp — 楽観 insert + onSuccess で server-truth に置換
// ============================================================
// 作成直後に picker / 一覧へ即時表示することで realtime invalidate を待つ
// (~数百 ms - 数秒) 体感ラグを消す。失敗時は snapshot で revert。
export function useCreateUserStamp() {
  const qc = useQueryClient();
  const show = useToastStore((s) => s.show);
  const userId = useAuthStore((s) => s.user?.id);

  type Input = { text: string; category?: string; isPublic?: boolean };
  type Ctx = { prev: UserStamp[] | undefined; tempId: string };

  return useMutation<UserStamp | null, Error, Input, Ctx>({
    mutationFn: (input) => createUserStamp(input.text, input.category, input.isPublic),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<UserStamp[]>(KEY);
      const tempId = `opt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      if (userId) {
        const optimistic: UserStamp = {
          id: tempId,
          creator_id: userId,
          text: input.text.trim(),
          category: input.category ?? 'カスタム',
          use_count: 0,
          is_public: input.isPublic ?? true,
          created_at: new Date().toISOString(),
        };
        qc.setQueryData<UserStamp[]>(KEY, (old) => [optimistic, ...(old ?? [])]);
      }
      return { prev, tempId };
    },
    onSuccess: (created, _input, ctx) => {
      // 楽観 entry を server-truth で置換 (tempId → 本物 id)
      if (created && ctx?.tempId) {
        qc.setQueryData<UserStamp[]>(KEY, (old) =>
          (old ?? []).map((s) => (s.id === ctx.tempId ? created : s)),
        );
      }
    },
    onError: (e, _input, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
      const msg = e instanceof Error ? e.message : 'スタンプの作成に失敗しました';
      show(msg, 'error');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteUserStamp() {
  const qc = useQueryClient();
  const show = useToastStore((s) => s.show);
  return useMutation({
    mutationFn: deleteUserStamp,
    onMutate: async (stampId) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<UserStamp[]>(KEY);
      qc.setQueryData<UserStamp[]>(KEY, (old) => (old ?? []).filter((s) => s.id !== stampId));
      return { prev };
    },
    onError: (e: unknown, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
      const msg = e instanceof Error ? e.message : 'スタンプの削除に失敗しました';
      show(msg, 'error');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
