// ============================================================
// useDiscovery — 検索タブ Discovery を 1 query key で取得
// ------------------------------------------------------------
// ['discovery', userId] の 1 useQuery にまとめる。fetchDiscoveryPayload が
// RPC→fallback を内部処理するので hook 側は単純。staleTime 0 + 親の focus
// invalidate で「タブを開くたびに新着」を維持 (feed/コミュ/検索と同方針)。
// ============================================================
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';
import { fetchDiscoveryPayload, type DiscoveryPayload } from '../lib/api/discovery';

const EMPTY: DiscoveryPayload = {
  hot: [],
  recommended: [],
  rising: [],
  official: [],
  myCommunityIds: [],
};

export function useDiscovery(enabled = true) {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const query = useQuery<DiscoveryPayload>({
    queryKey: ['discovery', userId],
    queryFn: () => fetchDiscoveryPayload(userId),
    enabled,
    staleTime: 0,
    retry: 1,
  });
  return {
    data: query.data ?? EMPTY,
    isLoading: query.isLoading,
    isFetched: query.isFetched,
    refetch: query.refetch,
  };
}
