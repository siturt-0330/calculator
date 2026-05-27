// ============================================================
// hooks/useAccountState.ts
// ============================================================
// 自分の account_state を React Query 経由で購読する hook.
//
// 用途:
//   - <AccountStateCard /> (mypage hero 直下)
//   - /settings/account-state 詳細画面
//
// 設計:
//   - staleTime 30s (admin が変更してから最大 30s で UI に反映)
//   - userId が無い (未ログイン) ときは fetch を完全に skip
//   - 既存 trigger trg_notify_account_state が同時に通知を insert するので、
//     useNotifications() の realtime invalidate が「未読あり」を即 push する。
//     その後、ユーザーが mypage に来た時にこの hook が refetch で最新 state を取る。
// ============================================================
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';
import {
  fetchMyAccountState,
  type AccountStateInfo,
} from '../lib/api/accountState';

const FALLBACK: AccountStateInfo = {
  state: 'healthy',
  restrictions: [],
  resolutionHint: '',
};

export function useAccountState() {
  const userId = useAuthStore((s) => s.user?.id);

  const q = useQuery<AccountStateInfo>({
    queryKey: ['account-state', userId ?? 'anon'],
    queryFn: fetchMyAccountState,
    staleTime: 30_000,
    enabled: !!userId,
  });

  // data が無い間は fallback を返して、card 側で null render を安全に判定できるようにする
  return {
    info: q.data ?? FALLBACK,
    isLoading: q.isLoading,
    error: q.error,
    refetch: q.refetch,
  };
}
