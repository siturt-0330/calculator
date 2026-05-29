// ============================================================
// useAdminCommunities — HomeDrawer 用、自分の参加コミュを役割で分割
// ------------------------------------------------------------
// `fetchMyCommunitiesWithRole` の結果を React Query で cache し、
// 管理者 (owner/admin/moderator) と一般参加 (member/null) に分けて返す。
// queryKey は `['my-communities-with-role', userId]`、staleTime 60s。
// ============================================================

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchMyCommunitiesWithRole, type CommunityWithRole } from '../lib/api/communities';
import { useAuthStore } from '../stores/authStore';

type Bucketed = {
  admin: CommunityWithRole[];
  joined: CommunityWithRole[];
  isLoading: boolean;
};

const ADMIN_ROLES: ReadonlySet<NonNullable<CommunityWithRole['role']>> = new Set([
  'owner',
  'admin',
  'moderator',
]);

export function useAdminCommunities(): Bucketed {
  const userId = useAuthStore((s) => s.user?.id);

  const q = useQuery({
    queryKey: ['my-communities-with-role', userId ?? 'anon'],
    queryFn: fetchMyCommunitiesWithRole,
    enabled: !!userId,
    staleTime: 60_000,
  });

  const data = q.data;

  // memo: q.data 参照が変わらない限り再計算しない (HomeDrawer の List virtualize で
  // データが入れ替わって見えるのを避ける)。
  // rows を useMemo の外で derive すると参照が毎 render で変わってしまうので
  // q.data を直接依存に入れる。
  const { admin, joined } = useMemo(() => {
    const a: CommunityWithRole[] = [];
    const j: CommunityWithRole[] = [];
    for (const c of data ?? []) {
      if (c.role && ADMIN_ROLES.has(c.role)) {
        a.push(c);
      } else {
        j.push(c);
      }
    }
    return { admin: a, joined: j };
  }, [data]);

  return { admin, joined, isLoading: q.isLoading };
}
