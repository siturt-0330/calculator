import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { attachChannel } from '../lib/realtime';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';
import { createUserStamp, deleteUserStamp, fetchUserStamps, type UserStamp } from '../lib/api/userStamps';

const KEY = ['user-stamps'];

export function useUserStamps() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);

  const q = useQuery({
    queryKey: KEY,
    queryFn: fetchUserStamps,
    staleTime: 60_000,
  });

  // Realtime: user_stamps の INSERT/DELETE で一覧を更新。
  // - 自分のスタンプ追加/削除はすぐ反映 (INSERT/DELETE)
  // - 他人の use_count 増加 (UPDATE) は user 体験への影響が低いので heavy-throttle
  // - INSERT は他人が公開スタンプを作った時に出すので表示候補に出すために必要
  //   ただし全 fanout は痛いので 10s window で集約。
  //
  // 旧版は debounce で「最後の event 後 N 秒経過してから invalidate」だったが、
  // 高頻度 INSERT が続く間 invalidate が永遠に走らない starvation が起きていた。
  // throttle (leading invoke + 末尾 trailing) に切り替えて確実に最新化される
  // ようにする。
  const lastInvalidate = useRef<number>(0);
  const trailing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const throttledInvalidate = (windowMs: number) => {
    const now = Date.now();
    const elapsed = now - lastInvalidate.current;
    if (elapsed >= windowMs) {
      lastInvalidate.current = now;
      qc.invalidateQueries({ queryKey: KEY });
      return;
    }
    if (trailing.current) return; // 既に末尾 trailing 予約済
    trailing.current = setTimeout(() => {
      trailing.current = null;
      lastInvalidate.current = Date.now();
      qc.invalidateQueries({ queryKey: KEY });
    }, windowMs - elapsed);
  };
  useEffect(() => {
    if (!userId) return;
    const detach = attachChannel('user-stamps-feed', (ch) =>
      // 自分のスタンプ変更は即時 (filter 経由でフルにスコープ)
      ch.on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'user_stamps',
        filter: `creator_id=eq.${userId}`,
      }, () => throttledInvalidate(800))
       // 他人の新規公開スタンプは heavy-throttle (10s) で集約
       // (use_count UPDATE はサーバー filter できないが、これも 10s window)
       .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'user_stamps',
       }, () => throttledInvalidate(10_000)),
    );
    return () => {
      detach();
      if (trailing.current) clearTimeout(trailing.current);
    };
    // qc 参照は安定。throttledInvalidate は closure-stable な ref 経由なので deps 不要。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  return { stamps: (q.data ?? []) as UserStamp[], isLoading: q.isLoading };
}

// ============================================================
// useCreateUserStamp — 楽観 insert + onSuccess で server-truth に置換
// ============================================================
// 作成直後に picker / 一覧へ即時表示することで realtime invalidate を待つ
// (~数百 ms - 数秒) 体感ラグを消す。失敗時は snapshot で revert。
export function useCreateUserStamp() {
  const qc = useQueryClient();
  const { show } = useToastStore();
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
  const { show } = useToastStore();
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
