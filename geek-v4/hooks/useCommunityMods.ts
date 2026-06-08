// ============================================================
// hooks/useCommunityMods.ts — コミュニティ管理人 (mod) React Query hooks
// ============================================================
// migration 0068 / lib/api/communityMods.ts を React Query で wrap。
//
// queryKey 体系 (CLAUDE.md § 5.2):
//   ['community-mods', 'members', communityId]
//   ['community-mods', 'bans', communityId]
//   ['community-mods', 'logs', communityId]
//
// mutation:
//   - optimistic update (members は kick / ban で対象行を消す、bans は追加)
//   - エラー時は revert + toast 表示
//   - 成功時は invalidate でサーバー真値に同期
// ============================================================

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  kickMember,
  banMember,
  unbanMember,
  promoteMember,
  demoteMember,
  transferOwnership,
  fetchCommunityMembers,
  fetchCommunityBans,
  fetchModActionLogs,
  deletePostAsMod,
  deleteCommentAsMod,
  deleteBBSReplyAsMod,
  fetchCommunityReports,
  resolveCommunityReport,
  type MemberWithProfile,
  type BanWithProfile,
  type ModActionLog,
  type CommunityReport,
} from '../lib/api/communityMods';
import { useToastStore } from '../stores/toastStore';

// ============================================================
// 一覧系 (read)
// ============================================================

export function useCommunityMembers(communityId: string | undefined): {
  members: MemberWithProfile[];
  isLoading: boolean;
  isError: boolean;
} {
  const q = useQuery({
    queryKey: ['community-mods', 'members', communityId ?? 'none'],
    queryFn: () => fetchCommunityMembers(communityId as string),
    staleTime: 30_000,
    enabled: !!communityId,
  });
  return {
    members: q.data ?? [],
    isLoading: q.isLoading,
    isError: q.isError,
  };
}

export function useCommunityBans(communityId: string | undefined): {
  bans: BanWithProfile[];
  isLoading: boolean;
  isError: boolean;
} {
  const q = useQuery({
    queryKey: ['community-mods', 'bans', communityId ?? 'none'],
    queryFn: () => fetchCommunityBans(communityId as string),
    staleTime: 30_000,
    enabled: !!communityId,
  });
  return {
    bans: q.data ?? [],
    isLoading: q.isLoading,
    isError: q.isError,
  };
}

export function useModActionLogs(
  communityId: string | undefined,
  limit: number = 50,
): {
  logs: ModActionLog[];
  isLoading: boolean;
  isError: boolean;
} {
  const q = useQuery({
    queryKey: ['community-mods', 'logs', communityId ?? 'none', limit],
    queryFn: () => fetchModActionLogs(communityId as string, limit),
    staleTime: 30_000,
    enabled: !!communityId,
  });
  return {
    logs: q.data ?? [],
    isLoading: q.isLoading,
    isError: q.isError,
  };
}

// コミュニティ通報キュー (mod が自コミュの未対応通報を一覧)
export function useCommunityReports(communityId: string | undefined): {
  reports: CommunityReport[];
  isLoading: boolean;
  isError: boolean;
} {
  const q = useQuery({
    queryKey: ['community-mods', 'reports', communityId ?? 'none'],
    queryFn: () => fetchCommunityReports(communityId as string),
    staleTime: 30_000,
    enabled: !!communityId,
  });
  return {
    reports: q.data ?? [],
    isLoading: q.isLoading,
    isError: q.isError,
  };
}

// ============================================================
// 共通: invalidate ヘルパ + toast
// ============================================================
function useInvalidateMods(communityId: string | undefined) {
  const qc = useQueryClient();
  return () => {
    if (!communityId) return;
    qc.invalidateQueries({ queryKey: ['community-mods', 'members', communityId] });
    qc.invalidateQueries({ queryKey: ['community-mods', 'bans', communityId] });
    qc.invalidateQueries({ queryKey: ['community-mods', 'logs', communityId] });
  };
}

function showErrorToast(message: string): void {
  // hook の外から呼ぶので getState() を使う (CLAUDE.md § 5.4 selector の方は read 用)。
  useToastStore.getState().show(message, 'error');
}

// ============================================================
// mutation: メンバー管理
// ============================================================
// 共通形: optimistic update でメンバー一覧から該当行を消す → 失敗時 revert
type KickInput = { communityId: string; userId: string; reason?: string };
type BanInput = { communityId: string; userId: string; reason?: string };
type UnbanInput = { communityId: string; userId: string };

export function useKickMember(communityId: string | undefined) {
  const qc = useQueryClient();
  const invalidate = useInvalidateMods(communityId);
  const membersKey = ['community-mods', 'members', communityId ?? 'none'];

  return useMutation({
    mutationFn: (input: KickInput) =>
      kickMember(input.communityId, input.userId, input.reason),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: membersKey });
      const prev = qc.getQueryData<MemberWithProfile[]>(membersKey);
      if (prev) {
        qc.setQueryData<MemberWithProfile[]>(
          membersKey,
          prev.filter((m) => m.user_id !== input.userId),
        );
      }
      return { prev };
    },
    onError: (err, _input, ctx) => {
      if (ctx?.prev) qc.setQueryData(membersKey, ctx.prev);
      const message = err instanceof Error ? err.message : 'キックに失敗しました';
      showErrorToast(message);
    },
    onSuccess: () => {
      useToastStore.getState().show('メンバーをキックしました', 'success');
    },
    onSettled: () => invalidate(),
  });
}

export function useBanMember(communityId: string | undefined) {
  const qc = useQueryClient();
  const invalidate = useInvalidateMods(communityId);
  const membersKey = ['community-mods', 'members', communityId ?? 'none'];

  return useMutation({
    mutationFn: (input: BanInput) =>
      banMember(input.communityId, input.userId, input.reason),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: membersKey });
      const prev = qc.getQueryData<MemberWithProfile[]>(membersKey);
      if (prev) {
        qc.setQueryData<MemberWithProfile[]>(
          membersKey,
          prev.filter((m) => m.user_id !== input.userId),
        );
      }
      return { prev };
    },
    onError: (err, _input, ctx) => {
      if (ctx?.prev) qc.setQueryData(membersKey, ctx.prev);
      const message = err instanceof Error ? err.message : 'BAN に失敗しました';
      showErrorToast(message);
    },
    onSuccess: () => {
      useToastStore.getState().show('メンバーを BAN しました', 'success');
    },
    onSettled: () => invalidate(),
  });
}

export function useUnbanMember(communityId: string | undefined) {
  const qc = useQueryClient();
  const invalidate = useInvalidateMods(communityId);
  const bansKey = ['community-mods', 'bans', communityId ?? 'none'];

  return useMutation({
    mutationFn: (input: UnbanInput) =>
      unbanMember(input.communityId, input.userId),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: bansKey });
      const prev = qc.getQueryData<BanWithProfile[]>(bansKey);
      if (prev) {
        qc.setQueryData<BanWithProfile[]>(
          bansKey,
          prev.filter((b) => b.user_id !== input.userId),
        );
      }
      return { prev };
    },
    onError: (err, _input, ctx) => {
      if (ctx?.prev) qc.setQueryData(bansKey, ctx.prev);
      const message = err instanceof Error ? err.message : 'BAN 解除に失敗しました';
      showErrorToast(message);
    },
    onSuccess: () => {
      useToastStore.getState().show('BAN を解除しました', 'success');
    },
    onSettled: () => invalidate(),
  });
}

// ============================================================
// mutation: 昇格 / 降格 (owner 専用 — 0069)
// ============================================================
// optimistic update: members cache 内で対象行の role だけを差し替える。
// 失敗時は revert + toast。成功時は invalidate でサーバー真値に同期。
type PromoteInput = { communityId: string; userId: string };
type DemoteInput = { communityId: string; userId: string };

export function usePromoteMember(communityId: string | undefined) {
  const qc = useQueryClient();
  const invalidate = useInvalidateMods(communityId);
  const membersKey = ['community-mods', 'members', communityId ?? 'none'];

  return useMutation({
    mutationFn: (input: PromoteInput) =>
      promoteMember(input.communityId, input.userId),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: membersKey });
      const prev = qc.getQueryData<MemberWithProfile[]>(membersKey);
      if (prev) {
        qc.setQueryData<MemberWithProfile[]>(
          membersKey,
          prev.map((m) =>
            m.user_id === input.userId ? { ...m, role: 'admin' as const } : m,
          ),
        );
      }
      return { prev };
    },
    onError: (err, _input, ctx) => {
      if (ctx?.prev) qc.setQueryData(membersKey, ctx.prev);
      const message = err instanceof Error ? err.message : '管理人への昇格に失敗しました';
      showErrorToast(message);
    },
    onSuccess: () => {
      useToastStore.getState().show('管理人に昇格しました', 'success');
    },
    onSettled: () => invalidate(),
  });
}

export function useDemoteMember(communityId: string | undefined) {
  const qc = useQueryClient();
  const invalidate = useInvalidateMods(communityId);
  const membersKey = ['community-mods', 'members', communityId ?? 'none'];

  return useMutation({
    mutationFn: (input: DemoteInput) =>
      demoteMember(input.communityId, input.userId),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: membersKey });
      const prev = qc.getQueryData<MemberWithProfile[]>(membersKey);
      if (prev) {
        qc.setQueryData<MemberWithProfile[]>(
          membersKey,
          prev.map((m) =>
            m.user_id === input.userId ? { ...m, role: 'member' as const } : m,
          ),
        );
      }
      return { prev };
    },
    onError: (err, _input, ctx) => {
      if (ctx?.prev) qc.setQueryData(membersKey, ctx.prev);
      const message = err instanceof Error ? err.message : 'member への降格に失敗しました';
      showErrorToast(message);
    },
    onSuccess: () => {
      useToastStore.getState().show('member に降格しました', 'success');
    },
    onSettled: () => invalidate(),
  });
}

// ============================================================
// mutation: オーナー譲渡 (owner 専用 — 0135)
// ============================================================
// optimistic: 新オーナー → owner、現 owner(自分) → admin に入れ替える。
type TransferInput = { communityId: string; userId: string };

export function useTransferOwnership(communityId: string | undefined) {
  const qc = useQueryClient();
  const invalidate = useInvalidateMods(communityId);
  const membersKey = ['community-mods', 'members', communityId ?? 'none'];

  return useMutation({
    mutationFn: (input: TransferInput) =>
      transferOwnership(input.communityId, input.userId),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: membersKey });
      const prev = qc.getQueryData<MemberWithProfile[]>(membersKey);
      if (prev) {
        qc.setQueryData<MemberWithProfile[]>(
          membersKey,
          prev.map((m) =>
            m.user_id === input.userId
              ? { ...m, role: 'owner' as const }
              : m.role === 'owner'
                ? { ...m, role: 'admin' as const }
                : m,
          ),
        );
      }
      return { prev };
    },
    onError: (err, _input, ctx) => {
      if (ctx?.prev) qc.setQueryData(membersKey, ctx.prev);
      const message = err instanceof Error ? err.message : 'オーナーの譲渡に失敗しました';
      showErrorToast(message);
    },
    onSuccess: () => {
      useToastStore.getState().show('オーナーを譲渡しました', 'success');
    },
    onSettled: () => invalidate(),
  });
}

// ============================================================
// mutation: 投稿 / コメント / 返信 の削除
// ============================================================
// optimistic update は対象が広範囲 (feed-page cache など) のため、
// ここでは onSuccess で invalidate するだけにとどめる。
// 個別の cache patch は呼び出し元 (UI 側) に任せる方が安全。
type DeleteInput = { id: string; reason?: string; communityId?: string };

export function useDeletePostAsMod(communityId: string | undefined) {
  const qc = useQueryClient();
  const invalidate = useInvalidateMods(communityId);

  return useMutation({
    mutationFn: (input: DeleteInput) =>
      deletePostAsMod(input.id, input.reason),
    onError: (err) => {
      const message = err instanceof Error ? err.message : '投稿の削除に失敗しました';
      showErrorToast(message);
    },
    onSuccess: () => {
      useToastStore.getState().show('投稿を削除しました', 'success');
      // 関連 feed cache も広めに invalidate
      qc.invalidateQueries({ queryKey: ['feed'] });
      qc.invalidateQueries({ queryKey: ['feed-page'] });
      qc.invalidateQueries({ queryKey: ['community-feed'] });
      // 削除した投稿が通報キューにあれば消える → reports も更新
      if (communityId) {
        qc.invalidateQueries({ queryKey: ['community-mods', 'reports', communityId] });
      }
    },
    onSettled: () => invalidate(),
  });
}

export function useDeleteCommentAsMod(communityId: string | undefined) {
  const qc = useQueryClient();
  const invalidate = useInvalidateMods(communityId);

  return useMutation({
    mutationFn: (input: DeleteInput) =>
      deleteCommentAsMod(input.id, input.reason),
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'コメントの削除に失敗しました';
      showErrorToast(message);
    },
    onSuccess: () => {
      useToastStore.getState().show('コメントを削除しました', 'success');
      qc.invalidateQueries({ queryKey: ['comments'] });
    },
    onSettled: () => invalidate(),
  });
}

export function useDeleteBBSReplyAsMod(communityId: string | undefined) {
  const qc = useQueryClient();
  const invalidate = useInvalidateMods(communityId);

  return useMutation({
    mutationFn: (input: DeleteInput) =>
      deleteBBSReplyAsMod(input.id, input.reason),
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'BBS 返信の削除に失敗しました';
      showErrorToast(message);
    },
    onSuccess: () => {
      useToastStore.getState().show('BBS 返信を削除しました', 'success');
      qc.invalidateQueries({ queryKey: ['bbs-thread'] });
      qc.invalidateQueries({ queryKey: ['bbs-replies'] });
    },
    onSettled: () => invalidate(),
  });
}

// ============================================================
// mutation: 通報を「対応済み」にする
// ============================================================
// optimistic: reports キューから該当 post を即座に消す → 失敗時 revert。
type ResolveReportInput = { communityId: string; postId: string };

export function useResolveCommunityReport(communityId: string | undefined) {
  const qc = useQueryClient();
  const reportsKey = ['community-mods', 'reports', communityId ?? 'none'];

  return useMutation({
    mutationFn: (input: ResolveReportInput) =>
      resolveCommunityReport(input.communityId, input.postId),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: reportsKey });
      const prev = qc.getQueryData<CommunityReport[]>(reportsKey);
      if (prev) {
        qc.setQueryData<CommunityReport[]>(
          reportsKey,
          prev.filter((r) => r.post_id !== input.postId),
        );
      }
      return { prev };
    },
    onError: (err, _input, ctx) => {
      if (ctx?.prev) qc.setQueryData(reportsKey, ctx.prev);
      const message = err instanceof Error ? err.message : '対応済みにできませんでした';
      showErrorToast(message);
    },
    onSuccess: () => {
      useToastStore.getState().show('対応済みにしました', 'success');
    },
    onSettled: () => {
      if (communityId) {
        qc.invalidateQueries({ queryKey: ['community-mods', 'reports', communityId] });
      }
    },
  });
}
