import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchFeatureFlags, userInRollout, type FeatureFlag } from '../lib/api/featureFlags';
import { useAuthStore } from '../stores/authStore';

const KEY = ['feature-flags'];

// ============================================================
// useFeatureFlags — feature flag 取得 + 判定
// ============================================================
// 旧構成: このファイルが個別 channel `feature-flags-watch` を attach。
// 新構成 (Audit E#5):
//   hooks/useUserChannel.ts の 1 user-wide channel に
//   `.on(feature_flags, ...)` で集約済み。
//   このファイルは React Query のみ管理し、cache invalidate は user channel が走らせる。
// ============================================================

export function useFeatureFlags() {
  const q = useQuery({
    queryKey: KEY,
    queryFn: fetchFeatureFlags,
    staleTime: 5 * 60 * 1000,  // 5分
  });

  return q.data ?? [];
}

// 単発フラグ判定
export function useFeatureFlag(name: string): boolean {
  const flags = useFeatureFlags();
  const userId = useAuthStore((s) => s.user?.id);
  // flags は session 中ほぼ不変。カード 1 枚で 3 回呼ばれるため、find +
  // userInRollout(FNV ハッシュ loop) を毎 render 走らせない (memo 化)。
  return useMemo(() => {
    const flag = flags.find((f: FeatureFlag) => f.name === name);
    if (!flag || !flag.enabled) return false;
    return userInRollout(userId, name, flag.percentage);
  }, [flags, userId, name]);
}
