// ============================================================
// hooks/useIsCommunityMod.ts — current user が当該 community の
// mod (owner / admin) かどうかを判定する hook
// ------------------------------------------------------------
// migration 0068: community_members.role は 'owner' | 'admin' | 'member'。
// ここでは owner / admin だけを「mod 権限あり」として扱う。
//
// 使い方:
//   const isMod = useIsCommunityMod(post.community_id);
//   <ModActionMenu isMod={isMod} ... />
//
// 注意:
//   - communityId が null/undefined のときは enabled:false で query を投げない
//     → 一般 (community 紐付け無し) post でも safe に false を返す
//   - 同一 (communityId, user_id) は 60s cache (stale) — ロール変更は頻繁では
//     ないので過剰な fetch を避ける
// ============================================================

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';

type CommunityRole = 'owner' | 'admin' | 'member';

export function useIsCommunityMod(
  communityId: string | null | undefined,
): boolean {
  const userId = useAuthStore((s) => s.user?.id);

  const { data: role } = useQuery<CommunityRole | null>({
    queryKey: ['community-my-role', communityId ?? 'none', userId ?? 'anon'],
    queryFn: async () => {
      if (!communityId || !userId) return null;
      const { data, error } = await supabase
        .from('community_members')
        .select('role')
        .eq('community_id', communityId)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) {
        // RLS による「読めない」も非 mod 扱い (false fallback)
        return null;
      }
      return (data?.role as CommunityRole | undefined) ?? null;
    },
    enabled: !!communityId && !!userId,
    staleTime: 60_000,
  });

  return role === 'owner' || role === 'admin';
}
