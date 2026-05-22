// ============================================================
// useCommunityStamps / useCommunityStampReactions
// ============================================================
// コミュスタンプ一覧 + リアクション集計を React Query で管理。
// 既存 useReactions.ts と同じパターン (realtime + optimistic)。
// ============================================================
import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import {
  listCommunityStamps,
  fetchCommunityStampReactionsForPosts,
  toggleCommunityStampReaction,
  createCommunityStamp,
  deleteCommunityStamp,
  type CommunityStamp,
  type CommunityStampAgg,
  type CommunityStampReactionsByPost,
} from '../lib/api/communityStamps';
import { attachChannel } from '../lib/realtime';
import { useToastStore } from '../stores/toastStore';

// ============================================================
// 1) コミュスタンプ一覧
// ============================================================
export function useCommunityStamps(communityId: string | undefined) {
  const qc = useQueryClient();
  const key = ['community-stamps', communityId];

  const q = useQuery({
    queryKey: key,
    queryFn: () => listCommunityStamps(communityId!),
    enabled: !!communityId,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  // Realtime: スタンプの追加 / 削除 / use_count 更新で invalidate
  // 同一 community 内のみを購読 (server-side filter)
  useEffect(() => {
    if (!communityId) return;
    const detach = attachChannel(
      `community-stamps:${communityId}`,
      (ch) =>
        ch.on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'community_stamps',
            filter: `community_id=eq.${communityId}`,
          },
          () => qc.invalidateQueries({ queryKey: key }),
        ),
    );
    return () => { try { detach(); } catch { /* ignore */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId, qc]);

  return q;
}

// ============================================================
// 2) 作成 / 削除 mutation
// ============================================================
export function useCreateCommunityStamp(communityId: string | undefined) {
  const qc = useQueryClient();
  const { show } = useToastStore();
  return useMutation({
    mutationFn: async (input: { label: string; image_url?: string | null }) => {
      if (!communityId) throw new Error('community_id not set');
      const { data, error } = await createCommunityStamp({
        community_id: communityId,
        label: input.label,
        image_url: input.image_url ?? null,
      });
      if (error || !data) throw new Error(error ?? '作成に失敗しました');
      return data;
    },
    onSuccess: () => {
      if (communityId) qc.invalidateQueries({ queryKey: ['community-stamps', communityId] });
      show('スタンプを作成しました', 'success');
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : '作成に失敗しました';
      show(msg, 'error');
    },
  });
}

export function useDeleteCommunityStamp(communityId: string | undefined) {
  const qc = useQueryClient();
  const { show } = useToastStore();
  return useMutation({
    mutationFn: async (stampId: string) => {
      const { error } = await deleteCommunityStamp(stampId);
      if (error) throw new Error(error);
    },
    onSuccess: () => {
      if (communityId) qc.invalidateQueries({ queryKey: ['community-stamps', communityId] });
      show('スタンプを削除しました', 'success');
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : '削除に失敗しました';
      show(msg, 'error');
    },
  });
}

// ============================================================
// 3) 投稿群のコミュスタンプリアクション集計
// ============================================================
export function useCommunityStampReactions(postIds: string[]) {
  const qc = useQueryClient();
  // sorted key で安定化 (useReactions と同じ手法)
  const sortedIds = useMemo(() => [...postIds].sort(), [postIds]);
  const idSet = useMemo(() => new Set(sortedIds), [sortedIds]);
  const sortedKey = useMemo(() => sortedIds.join(','), [sortedIds]);

  const q = useQuery({
    queryKey: ['community-stamp-reactions', sortedKey],
    queryFn: () => fetchCommunityStampReactionsForPosts(sortedIds),
    enabled: sortedIds.length > 0,
    staleTime: 30_000,
  });

  // realtime: 当該 post 群への INSERT/DELETE で invalidate
  // PostgREST in.(...) フィルタは長すぎると 414 になるので 30 件で打ち切り
  useEffect(() => {
    if (sortedIds.length === 0) return;
    const watchIds = sortedIds.slice(0, 30);
    const detach = attachChannel(
      `community-stamp-reactions:${sortedKey.slice(0, 100)}`,
      (ch) =>
        ch.on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'community_stamp_reactions',
            filter: `post_id=in.(${watchIds.join(',')})`,
          },
          (payload: { new?: { post_id?: string }; old?: { post_id?: string } }) => {
            const pid = payload.new?.post_id ?? payload.old?.post_id;
            if (pid && idSet.has(pid)) {
              qc.invalidateQueries({ queryKey: ['community-stamp-reactions', sortedKey] });
            }
          },
        ),
    );
    return () => { try { detach(); } catch { /* ignore */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedKey, qc]);

  return q;
}

// ============================================================
// 4) リアクションのトグル
// ============================================================
export function useCommunityStampReactionToggle() {
  const qc = useQueryClient();
  const { show } = useToastStore();
  return useMutation({
    mutationFn: async (vars: { postId: string; stampId: string }) => {
      const { on, error } = await toggleCommunityStampReaction(vars.postId, vars.stampId);
      if (error) throw new Error(error);
      return on;
    },
    onSuccess: () => {
      // 集計を最新化 (全 page invalidate でも軽量、対象は post_id ベース)
      qc.invalidateQueries({ queryKey: ['community-stamp-reactions'] });
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : 'リアクションに失敗しました';
      show(msg, 'error');
    },
  });
}

// 型 re-export
export type { CommunityStamp, CommunityStampAgg, CommunityStampReactionsByPost };
