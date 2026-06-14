// =============================================================================
// hooks/useContests.ts — コンテスト機能の React Query フック
// -----------------------------------------------------------------------------
// 集計 (breakdown) は「他人の投票」で変わるため軽くポーリングする (refetchInterval)。
// 投票 (castVote) は不可逆なので楽観更新せず、成功後に breakdown/contest を invalidate。
// =============================================================================

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  castVote,
  confirmResult,
  createContest,
  createContestCommunity,
  fetchActiveContestCommunityIds,
  getBreakdown,
  getContest,
  getContestJoinState,
  getResult,
  isContestAuthor,
  listContestsByCommunity,
  listOpenContests,
  reportContest,
  submitEntry,
  type CastVoteInput,
  type Contest,
  type CreateContestCommunityInput,
  type CreateContestInput,
} from '../lib/api/contests';
import { joinCommunity } from '../lib/api/communities-membership';

const KEYS = {
  contest: (id: string) => ['contest', id] as const,
  breakdown: (id: string) => ['contest-breakdown', id] as const,
  result: (id: string) => ['contest-result', id] as const,
  byCommunity: (cid: string) => ['contests', 'community', cid] as const,
  open: () => ['contests', 'open'] as const,
};

export function useContest(id: string | undefined) {
  return useQuery({
    queryKey: KEYS.contest(id ?? ''),
    queryFn: () => getContest(id as string),
    enabled: !!id,
    staleTime: 30_000,
  });
}

export function useContestsByCommunity(communityId: string | undefined) {
  return useQuery({
    queryKey: KEYS.byCommunity(communityId ?? ''),
    queryFn: () => listContestsByCommunity(communityId as string),
    enabled: !!communityId,
    staleTime: 30_000,
  });
}

// コンテスト開催中の community_id 集合 (アバターのリング判定)
export function useActiveContestCommunities() {
  return useQuery({
    queryKey: ['active-contest-communities'],
    queryFn: fetchActiveContestCommunityIds,
    staleTime: 60_000,
    select: (ids) => new Set(ids),
  });
}

export function useOpenContests(enabled = true) {
  return useQuery({
    queryKey: KEYS.open(),
    queryFn: () => listOpenContests(),
    enabled,
    staleTime: 30_000,
  });
}

// 集計。投票済み (またはフェーズが進んでいる) と中身が増えるので、画面表示中は軽くポーリング。
export function useContestBreakdown(id: string | undefined, opts?: { poll?: boolean }) {
  return useQuery({
    queryKey: KEYS.breakdown(id ?? ''),
    queryFn: () => getBreakdown(id as string),
    enabled: !!id,
    staleTime: 10_000,
    refetchInterval: opts?.poll ? 30_000 : false,
  });
}

// 正解。result_at 経過後のみ revealed。経過前は無駄に叩かないよう enabled で制御。
export function useContestResult(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: KEYS.result(id ?? ''),
    queryFn: () => getResult(id as string),
    enabled: !!id && enabled,
    staleTime: 30_000,
  });
}

// ② コンテストコミュニティ
export function useContestJoinState(id: string | undefined) {
  return useQuery({
    queryKey: ['contest-join-state', id ?? ''],
    queryFn: () => getContestJoinState(id as string),
    enabled: !!id,
    staleTime: 15_000,
  });
}

export function useCreateContestCommunity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateContestCommunityInput) => createContestCommunity(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['contests', 'open'] });
      void qc.invalidateQueries({ queryKey: ['my-communities'] });
    },
  });
}

// 入場ゲートを通って参加する (= 答えた人が「参加する」を押したとき)。join_community_by_id がゲートを判定。
export function useJoinContestCommunity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { communityId: string; contestId: string }) => {
      const { error } = await joinCommunity(vars.communityId);
      if (error) throw new Error(error);
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['contest-join-state', vars.contestId] });
      void qc.invalidateQueries({ queryKey: ['my-communities'] });
    },
  });
}

export function useIsContestAuthor(id: string | undefined) {
  return useQuery({
    queryKey: ['contest-is-author', id ?? ''],
    queryFn: () => isContestAuthor(id as string),
    enabled: !!id,
    staleTime: 5 * 60_000,
  });
}

export function useCreateContest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateContestInput) => createContest(input),
    onSuccess: (contest: Contest) => {
      void qc.invalidateQueries({ queryKey: KEYS.byCommunity(contest.community_id) });
      void qc.invalidateQueries({ queryKey: KEYS.open() });
    },
  });
}

export function useCastVote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CastVoteInput) => castVote(input),
    onSuccess: (_d, input) => {
      void qc.invalidateQueries({ queryKey: KEYS.breakdown(input.contestId) });
      void qc.invalidateQueries({ queryKey: KEYS.contest(input.contestId) });
    },
  });
}

export function useSubmitEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { contestId: string; label?: string; mediaUrl?: string | null; mediaType?: 'image' | 'video' | null }) =>
      submitEntry(vars.contestId, { label: vars.label, mediaUrl: vars.mediaUrl, mediaType: vars.mediaType }),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: KEYS.contest(vars.contestId) });
    },
  });
}

export function useConfirmResult() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { contestId: string; optionId: string }) => confirmResult(vars.contestId, vars.optionId),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: KEYS.result(vars.contestId) });
      void qc.invalidateQueries({ queryKey: KEYS.breakdown(vars.contestId) });
    },
  });
}

export function useReportContest() {
  return useMutation({
    mutationFn: (vars: { contestId: string; reason?: string }) => reportContest(vars.contestId, vars.reason),
  });
}
