import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { attachChannel } from '../lib/realtime';
import { useAuthStore } from '../stores/authStore';
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
  // - 他人の use_count 増加 (UPDATE) は user 体験への影響が低いので heavy-debounce
  // - INSERT は他人が公開スタンプを作った時に出すので、表示候補に出すために必要
  //   ただし全 fanout は痛いので 10s debounce で集約。
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedInvalidate = (delay: number) => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      qc.invalidateQueries({ queryKey: KEY });
    }, delay);
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
      }, () => debouncedInvalidate(800))
       // 他人の新規公開スタンプは heavy-debounce (10s) で集約
       // (use_count UPDATE はサーバー filter できないが、これも 10s debounce)
       .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'user_stamps',
       }, () => debouncedInvalidate(10_000)),
    );
    return () => {
      detach();
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [qc, userId]);

  return { stamps: (q.data ?? []) as UserStamp[], isLoading: q.isLoading };
}

export function useCreateUserStamp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { text: string; category?: string; isPublic?: boolean }) =>
      createUserStamp(input.text, input.category, input.isPublic),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteUserStamp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteUserStamp,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
