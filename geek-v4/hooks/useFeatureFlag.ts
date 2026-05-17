import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { fetchFeatureFlags, userInRollout, type FeatureFlag } from '@/lib/api/featureFlags';
import { useAuthStore } from '@/stores/authStore';

const KEY = ['feature-flags'];

export function useFeatureFlags() {
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: KEY,
    queryFn: fetchFeatureFlags,
    staleTime: 5 * 60 * 1000,  // 5分
  });

  useEffect(() => {
    const channel = supabase
      .channel('feature-flags-watch')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'feature_flags' },
        () => qc.invalidateQueries({ queryKey: KEY }),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);

  return q.data ?? [];
}

// 単発フラグ判定
export function useFeatureFlag(name: string): boolean {
  const flags = useFeatureFlags();
  const userId = useAuthStore((s) => s.user?.id);
  const flag = flags.find((f: FeatureFlag) => f.name === name);
  if (!flag) return false;
  if (!flag.enabled) return false;
  return userInRollout(userId, name, flag.percentage);
}
