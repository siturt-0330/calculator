import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { attachChannel } from '@/lib/realtime';
import { fetchMyBadges, fetchBadgeDefinitions, type UserBadge, type BadgeDef } from '@/lib/api/badges';

export function useMyBadges() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['my-badges'],
    queryFn: fetchMyBadges,
    staleTime: 5 * 60_000,
  });
  useEffect(() => {
    return attachChannel('badges-watch', (ch) =>
      ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'user_badges' },
        () => qc.invalidateQueries({ queryKey: ['my-badges'] })),
    );
  }, [qc]);
  return { badges: (q.data ?? []) as UserBadge[], isLoading: q.isLoading };
}

export function useBadgeDefinitions() {
  const q = useQuery({
    queryKey: ['badge-defs'],
    queryFn: fetchBadgeDefinitions,
    staleTime: 60 * 60_000,
  });
  return { defs: (q.data ?? []) as BadgeDef[] };
}
