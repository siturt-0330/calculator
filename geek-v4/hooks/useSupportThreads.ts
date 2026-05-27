// ============================================================
// useSupportThreads — Modmail 一覧 hook (user / admin 両用)
// ============================================================
// 用途:
//   - user 用: 自分の問い合わせ一覧 (listMyThreads)
//   - admin 用: 全ユーザーの問い合わせ一覧 (listAdminThreads)
//   - createThread mutation: 新規スレッドを作成
//
// queryKey:
//   ['support-threads', 'me']
//   ['support-threads', 'admin', filter]
// ============================================================
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listMyThreads,
  listAdminThreads,
  createThread,
  type SupportThread,
  type SupportThreadCategory,
  type SupportThreadState,
  type SupportThreadWithNickname,
} from '../lib/api/support';
import { useAuthStore } from '../stores/authStore';

// user 用: 自分の threads
export function useMySupportThreads() {
  const userId = useAuthStore((s) => s.user?.id);
  const q = useQuery({
    queryKey: ['support-threads', 'me', userId],
    queryFn: listMyThreads,
    enabled: !!userId,
    // 30s: 新着 admin 返信は notification 経由で気付くので頻繁な refetch は不要
    staleTime: 30_000,
    retry: 1,
  });
  return {
    threads: (q.data ?? []) as SupportThread[],
    isLoading: q.isLoading,
    isRefetching: q.isRefetching,
    refetch: q.refetch,
    error: q.error,
  };
}

// admin 用: 全 threads + filter
export function useAdminSupportThreads(filter?: {
  state?: SupportThreadState | 'all';
  category?: SupportThreadCategory | 'all';
}) {
  const stateKey = filter?.state ?? 'all';
  const catKey = filter?.category ?? 'all';
  const q = useQuery({
    queryKey: ['support-threads', 'admin', stateKey, catKey],
    queryFn: () => listAdminThreads(filter),
    // admin はもう少し頻繁に更新したい (見落とし防止)
    staleTime: 15_000,
    retry: 1,
  });
  return {
    threads: (q.data ?? []) as SupportThreadWithNickname[],
    isLoading: q.isLoading,
    isRefetching: q.isRefetching,
    refetch: q.refetch,
    error: q.error,
  };
}

// 新規スレッド作成 mutation
export function useCreateSupportThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createThread,
    onSuccess: () => {
      // user / admin 両方の一覧を invalidate (本人画面 + admin 画面で同時に更新)
      void qc.invalidateQueries({ queryKey: ['support-threads'] });
    },
  });
}
