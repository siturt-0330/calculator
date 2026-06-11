// =============================================================================
// useCommunityJoinRequests — owner 用: 保留中の参加申請を取得・承認・拒否
// -----------------------------------------------------------------------------
// admin.tsx の「参加申請」セクションが消費する。承認すると申請者は
// community_members に追加され、申請は status='approved' に更新される。
// =============================================================================

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  approveJoinRequest,
  fetchPendingJoinRequests,
  rejectJoinRequest,
  type JoinRequestWithProfile,
} from '../lib/api/communities';
import { useToastStore } from '../stores/toastStore';

export function useCommunityJoinRequests(communityId: string | undefined) {
  const q = useQuery<JoinRequestWithProfile[]>({
    queryKey: ['community-join-requests', communityId],
    queryFn: () => fetchPendingJoinRequests(communityId!),
    enabled: !!communityId,
    staleTime: 30_000,
  });
  return { requests: q.data ?? [], isLoading: q.isLoading };
}

export function useApproveJoinRequest(communityId: string) {
  const qc = useQueryClient();
  const show = useToastStore((s) => s.show);
  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await approveJoinRequest(communityId, userId);
      if (error) throw new Error(error);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['community-join-requests', communityId] });
      qc.invalidateQueries({ queryKey: ['community-mods', 'members', communityId] });
      qc.invalidateQueries({ queryKey: ['community', communityId] });
      show('参加を承認しました', 'success');
    },
    onError: (e: Error) => show(`承認に失敗: ${e.message}`, 'error'),
  });
}

export function useRejectJoinRequest(communityId: string) {
  const qc = useQueryClient();
  const show = useToastStore((s) => s.show);
  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await rejectJoinRequest(communityId, userId);
      if (error) throw new Error(error);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['community-join-requests', communityId] });
      show('申請を拒否しました', 'info');
    },
    onError: (e: Error) => show(`拒否に失敗: ${e.message}`, 'error'),
  });
}
