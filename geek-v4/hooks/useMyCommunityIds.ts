// ============================================================
// useMyCommunityIds — 自分が参加中のコミュニティ id 集合
// ------------------------------------------------------------
// 探索/検索タブの「参加」ボタンが「既に参加済みか」を判定するのに使う。
// fetchMyCommunities() を React Query (key=['my-community-ids']) で 1 回だけ
// 叩き、複数カードから呼ばれても同一 key で dedupe される。結果は Set<string>
// に変換して O(1) 判定できるようにする。未ログイン時は空 Set。
//
// 参加成功後は呼び出し側で qc.invalidateQueries(['my-community-ids']) する。
// ============================================================
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchMyCommunities } from '../lib/api/communities';
import { useAuthStore } from '../stores/authStore';

export function useMyCommunityIds(): { idSet: Set<string>; isLoading: boolean } {
  const userId = useAuthStore((s) => s.user?.id ?? null);

  const query = useQuery({
    queryKey: ['my-community-ids'],
    queryFn: async (): Promise<string[]> => {
      const list = await fetchMyCommunities();
      return list.map((c) => c.id);
    },
    enabled: !!userId,
    staleTime: 60_000,
  });

  const idSet = useMemo(() => new Set(query.data ?? []), [query.data]);
  return { idSet, isLoading: query.isLoading };
}
