// ============================================================
// hooks/useFriendInvites.ts — 招待コード発行 / 取消 / 受諾
// ============================================================
// 招待 URL は createInvite の戻り値で URL を組み立てて返す (UI 側で共有 / コピー)。
// 受諾後は friend 系 cache を invalidate する。
// ============================================================

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchMyInvites,
  createFriendInvite,
  revokeInvite,
  acceptInvite,
  inviteUrlFor,
} from '../lib/api/friends';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';
import type { FriendInvite } from '../types/models';

// ============================================================
// useMyInvites — 自分発行の招待一覧
// ============================================================
export function useMyInvites(): {
  invites: FriendInvite[];
  isLoading: boolean;
} {
  const userId = useAuthStore((s) => s.user?.id);
  const q = useQuery({
    queryKey: ['friend-invites', 'mine', userId ?? 'anon'],
    queryFn: fetchMyInvites,
    staleTime: 30_000,
    enabled: !!userId,
  });
  return {
    invites: q.data ?? [],
    isLoading: q.isLoading,
  };
}

// ============================================================
// useCreateInvite — 招待 URL を生成
// ============================================================
// 戻り値の data には url を同梱して呼び出し側で簡単にコピー/共有できるように。
// FriendInvite はそのまま含むので code, expires_at 等の表示も可能。
export function useCreateInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<FriendInvite & { url: string }> => {
      const invite = await createFriendInvite();
      return { ...invite, url: inviteUrlFor(invite.code) };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['friend-invites'] });
    },
  });
}

// ============================================================
// useRevokeInvite — 招待コードを取消
// ============================================================
export function useRevokeInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => revokeInvite(code),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['friend-invites'] });
    },
  });
}

// ============================================================
// useAcceptInvite — 受諾 RPC
// ============================================================
// 受諾成功なら friends 系 + friend-invites 系を両方 invalidate。
// 戻り値の ok=false でも throw はしない (UI 側で error メッセージ表示するため)。
//
// ★ 2026-05 修正: ネットワークエラー時に UI が loading のまま固まる +
//   ok=false でも cache が invalidate されて「成功したかと思ったら失敗」状態
//   になっていたのを修正。onError 追加 + ok=false 時の invalidate 抑制。
export function useAcceptInvite() {
  const qc = useQueryClient();
  const show = useToastStore((s) => s.show);
  return useMutation({
    mutationFn: (code: string) => acceptInvite(code),
    onSuccess: (result) => {
      if (result.ok) {
        qc.invalidateQueries({ queryKey: ['friends'] });
        qc.invalidateQueries({ queryKey: ['friend-invites'] });
        show('友達になりました', 'success');
      } else {
        // ok=false の場合は cache invalidate せずエラー表示
        show(result.error ?? '受け入れに失敗しました', 'error');
      }
    },
    onError: (err) => {
      console.warn('[acceptInvite] error:', err);
      show('ネットワークエラーが発生しました', 'error');
    },
  });
}
