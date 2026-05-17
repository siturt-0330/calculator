import { supabase } from '@/lib/supabase';

export type FeatureFlag = {
  name: string;
  description: string | null;
  enabled: boolean;
  percentage: number;  // 0..100
};

export async function fetchFeatureFlags(): Promise<FeatureFlag[]> {
  const { data, error } = await supabase
    .from('feature_flags')
    .select('name, description, enabled, percentage');
  if (error) return [];
  return (data ?? []) as FeatureFlag[];
}

// 安定したハッシュで user_id → 0..99 を求め、percentage に入るか判定
export function userInRollout(userId: string | undefined, flagName: string, percentage: number): boolean {
  if (!userId) return percentage >= 100;
  if (percentage <= 0) return false;
  if (percentage >= 100) return true;
  // 単純ハッシュ (FNV-1a 風)
  let h = 2166136261 >>> 0;
  const s = `${userId}:${flagName}`;
  for (let i = 0; i < s.length; i++) {
    h = (h ^ s.charCodeAt(i)) >>> 0;
    h = (h * 16777619) >>> 0;
  }
  const bucket = h % 100;
  return bucket < percentage;
}
