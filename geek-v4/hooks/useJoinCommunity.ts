// ============================================================
// useJoinCommunity — コミュ参加ボタンの共通ハンドラ
//
// カードの「参加」ボタンと「カードタップ→詳細」を一本化する hook。
// visibility が 'open' のときだけその場で join_community RPC を叩き、
// 成功したら ['my-community-ids'] / ['my-communities'] を invalidate して
// メンバーシップ表示を即更新する (= optimistic-ish: ローカルは joiningIds で
// ボタンを即 disabled にし、確定はサーバ応答後の invalidate に委ねる)。
// 'request' / 'invite' は申請フローが詳細画面側に居るため、ここでは
// 詳細画面へ遷移させるだけ。二重タップは joiningIds の Set で O(1) ガード。
// ============================================================
import { useState, useCallback } from 'react';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { joinCommunity, type Community } from '../lib/api/communities';
import { useToastStore } from '../stores/toastStore';

export type JoinAction = 'none' | 'join' | 'navigate';

// メンバーシップと visibility から「カードの参加ボタンが何をすべきか」を導く純関数。
// テスト容易性のため hook 外に切り出す。
export function deriveJoinAction(
  community: Pick<Community, 'visibility'>,
  isMember: boolean,
): JoinAction {
  if (isMember) return 'none';
  if (community.visibility === 'open') return 'join';
  return 'navigate'; // 'request' | 'invite' → 詳細画面で申請する
}

export function useJoinCommunity(): {
  joiningIds: Set<string>;
  onJoin: (community: Community) => void;
  onPressCommunity: (community: Community) => void;
} {
  const router = useRouter();
  const qc = useQueryClient();
  const show = useToastStore((s) => s.show);
  const [joiningIds, setJoiningIds] = useState<Set<string>>(new Set());

  const onPressCommunity = useCallback(
    (c: Community) => {
      router.push(`/community/${c.id}` as never);
    },
    [router],
  );

  const onJoin = useCallback(
    async (c: Community) => {
      // request / invite はその場で参加できない → 申請フローのある詳細画面へ
      if (c.visibility !== 'open') {
        router.push(`/community/${c.id}` as never);
        return;
      }

      // 二重タップガード: 既に処理中なら no-op。
      // functional update で現在の Set を読み、追加済みなら早期 return する。
      let alreadyJoining = false;
      setJoiningIds((prev) => {
        if (prev.has(c.id)) {
          alreadyJoining = true;
          return prev;
        }
        const next = new Set(prev);
        next.add(c.id);
        return next;
      });
      if (alreadyJoining) return;

      try {
        const { error } = await joinCommunity(c.id);
        if (error) {
          show(error || '参加に失敗しました', 'error');
        } else {
          show(`${c.name} に参加しました`, 'success');
          // メンバーシップ系 cache を両方 invalidate して表示を即更新
          qc.invalidateQueries({ queryKey: ['my-community-ids'] });
          qc.invalidateQueries({ queryKey: ['my-communities'] });
        }
      } catch {
        show('通信エラーが発生しました', 'error');
      } finally {
        setJoiningIds((prev) => {
          if (!prev.has(c.id)) return prev;
          const next = new Set(prev);
          next.delete(c.id);
          return next;
        });
      }
    },
    [router, show, qc],
  );

  // async コールバックを void 戻り値に合わせる (promise は意図的に無視)。
  const onJoinVoid = useCallback(
    (c: Community) => {
      void onJoin(c);
    },
    [onJoin],
  );

  return { joiningIds, onJoin: onJoinVoid, onPressCommunity };
}
