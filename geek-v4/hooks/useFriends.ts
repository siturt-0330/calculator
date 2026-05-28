// ============================================================
// hooks/useFriends.ts — 友達一覧 / pending / 承認 / 拒否 / 解除
// ============================================================
// CLAUDE.md § 5.2: queryKey は配列 prefix + id。userId は useAuthStore selector で取る。
// mutation の onSuccess で関連 queryKey を invalidate するパターン。
// ============================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchMyFriends,
  fetchPendingRequests,
  acceptFriend,
  declineFriend,
  unfriend,
  type FriendshipWithProfile,
} from '../lib/api/friends';
import { useAuthStore } from '../stores/authStore';

// ============================================================
// useMyFriends — accepted 友達一覧
// ============================================================
export function useMyFriends(): {
  friends: FriendshipWithProfile[];
  isLoading: boolean;
} {
  const userId = useAuthStore((s) => s.user?.id);
  const q = useQuery({
    queryKey: ['friends', 'mine', userId ?? 'anon'],
    queryFn: fetchMyFriends,
    // ★ パフォーマンス改善 (2026-05-28):
    //   友達一覧は static-ish (頻繁に追加/削除されない)。30s → 5min に延長して
    //   mypage / friends / invite 画面間の遷移で毎回 refetch を抑制。
    //   accept / decline / unfriend の mutation で invalidate されるので
    //   操作直後は即座に反映される。
    staleTime: 5 * 60_000,
    enabled: !!userId,
  });
  return {
    friends: q.data ?? [],
    isLoading: q.isLoading,
  };
}

// ============================================================
// usePendingRequests — incoming/outgoing pending リクエスト
// ============================================================
export function usePendingRequests(): {
  incoming: FriendshipWithProfile[];
  outgoing: FriendshipWithProfile[];
  isLoading: boolean;
} {
  const userId = useAuthStore((s) => s.user?.id);
  const q = useQuery({
    queryKey: ['friends', 'pending', userId ?? 'anon'],
    queryFn: fetchPendingRequests,
    staleTime: 30_000,
    enabled: !!userId,
  });
  return {
    incoming: q.data?.incoming ?? [],
    outgoing: q.data?.outgoing ?? [],
    isLoading: q.isLoading,
  };
}

// ============================================================
// 共通 invalidate ヘルパ — friend 系 query をまとめて再 fetch
// ============================================================
function useInvalidateFriendQueries() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['friends'] });
  };
}

// ============================================================
// 承認 / 拒否 / 解除 mutation
// ============================================================
export function useAcceptFriend() {
  const invalidate = useInvalidateFriendQueries();
  return useMutation({
    mutationFn: (friendshipId: string) => acceptFriend(friendshipId),
    onSuccess: () => invalidate(),
  });
}

export function useDeclineFriend() {
  const invalidate = useInvalidateFriendQueries();
  return useMutation({
    mutationFn: (friendshipId: string) => declineFriend(friendshipId),
    onSuccess: () => invalidate(),
  });
}

export function useUnfriend() {
  const invalidate = useInvalidateFriendQueries();
  return useMutation({
    mutationFn: (friendshipId: string) => unfriend(friendshipId),
    onSuccess: () => invalidate(),
  });
}
