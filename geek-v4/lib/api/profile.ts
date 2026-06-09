// ============================================================
// lib/api/profile.ts — プロフィール取得 API
// ============================================================
// mypage.tsx / feed.tsx (warm-up) 双方で使う共通 queryFn。
// queryKey は ['mypage-stats', userId] で統一し、
// feed.tsx の prefetch と mypage.tsx の useQuery が同じ cache を共有する。
// ============================================================

import { supabase } from '../supabase';
import { withApiTimeout } from '../withApiTimeout';

/** mypage-stats cache に格納するプロフィールの正規型 */
export type ProfileStats = {
  nickname: string | null;
  avatar_emoji: string | null;
  avatar_url: string | null;
  cover_url: string | null;
};

/**
 * mypage.tsx の `useQuery(['mypage-stats', userId])` と queryFn/SELECT を完全一致させる。
 * feed.tsx の prefetchQuery もこれを使うことでキャッシュが共有され mypage での再 fetch を防ぐ。
 */
export async function fetchProfileStatsFull(userId: string): Promise<ProfileStats | null> {
  const { data, error } = await withApiTimeout(
    supabase
      .from('profiles')
      .select('nickname, avatar_emoji, avatar_url, cover_url')
      .eq('id', userId)
      .single(),
    'profile.statsFull',
    8000,
  );
  if (error) throw error;
  return (data ?? null) as ProfileStats | null;
}
