// ============================================================
// hooks/useUserChannel.ts
// ------------------------------------------------------------
// 1 user セッションで横断的に必要な user-scoped realtime を **1 channel** に集約。
//
// 旧構成 (Audit E#5):
//   useNotifications        → notifications:userId  (parallel singleton 経路, attachChannel 経由でない)
//   useFeatureFlags         → feature-flags-watch
//   useBookmarks/useCollections → bookmark-collections-watch:userId
//   useSavedSearches        → saved-searches-watch:userId
//   useUserStamps           → user-stamps-feed   (creator_id=userId filter + INSERT 集約)
//
//   feed タブで notifications + feature_flags は常時 mount 済 (TabBar / AnonPostCard),
//   さらに mypage / search / community で個別 mount すると 4-5 channel が常時 open。
//
// 新構成:
//   1 channel name = `user:${userId}` に対し
//     .on(notifications, filter=user_id=eq.userId)
//     .on(feature_flags) -- publication 全件 (no filter)
//     .on(bookmark_collections, filter=user_id=eq.userId)
//     .on(saved_searches, filter=user_id=eq.userId)
//     .on(user_stamps, filter=creator_id=eq.userId)
//
//   ★ CLAUDE.md § 5.3 で **1 channel に複数 table を chain** は publication 未登録 table
//     が混ざると CHANNEL_ERROR cascade する地雷だが、ここで列挙する 5 テーブルは
//     すべて publication 登録済 (0008/0010/0013/0009 で確認) なので安全。
//     新規 table を追加する時は必ず publication 登録の有無を確認すること。
//
// useNotifications などの旧 hook は、この useUserChannel が attach 済の前提で
// realtime 経路を保持し、自身は React Query のみ管理する (channel attach はしない)。
//
// mount 場所:
//   app/_layout.tsx で 1 度だけ呼ぶ。auth 後 / signOut 後の userId 変化に追従する。
// ============================================================

import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { attachChannel } from '../lib/realtime';
import { useAuthStore } from '../stores/authStore';
import type { Notification } from '../types/models';

const NOTIF_KEY = ['notifications'] as const;
const FEATURE_FLAGS_KEY = ['feature-flags'] as const;
const BOOKMARK_COLLECTIONS_KEY = ['bookmark-collections'] as const;
const SAVED_SEARCHES_KEY = ['saved-searches'] as const;
const USER_STAMPS_KEY = ['user-stamps'] as const;

function bindUserChannel(userId: string, qc: QueryClient) {
  return attachChannel(
    `user:${userId}`,
    (ch) =>
      ch
        // ----- notifications: INSERT は cache に直 prepend (新着即時)
        //                      UPDATE は invalidate (read flag 更新 等)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${userId}`,
          },
          (payload) => {
            const newRow = payload.new as Notification;
            qc.setQueryData<Notification[]>(NOTIF_KEY as unknown as readonly unknown[], (old) =>
              [newRow, ...(old ?? [])],
            );
          },
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${userId}`,
          },
          () => qc.invalidateQueries({ queryKey: NOTIF_KEY as unknown as readonly unknown[] }),
        )
        // ----- feature_flags: 全行に対する変更で invalidate (filter なし: publication 全体)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'feature_flags' },
          () => qc.invalidateQueries({ queryKey: FEATURE_FLAGS_KEY as unknown as readonly unknown[] }),
        )
        // ----- bookmark_collections: 自分のだけ
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'bookmark_collections',
            filter: `user_id=eq.${userId}`,
          },
          () => qc.invalidateQueries({ queryKey: BOOKMARK_COLLECTIONS_KEY as unknown as readonly unknown[] }),
        )
        // ----- saved_searches: 自分のだけ
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'saved_searches',
            filter: `user_id=eq.${userId}`,
          },
          () => qc.invalidateQueries({ queryKey: SAVED_SEARCHES_KEY as unknown as readonly unknown[] }),
        )
        // ----- user_stamps: 自分が作ったスタンプ (creator_id でフィルタ)
        //   旧 useUserStamps は他人の INSERT も heavy-throttle で見ていたが、
        //   一覧表示は staleTime 60s + focus 補完で十分鮮度を保てる。
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'user_stamps',
            filter: `creator_id=eq.${userId}`,
          },
          () => qc.invalidateQueries({ queryKey: USER_STAMPS_KEY as unknown as readonly unknown[] }),
        ),
    (status, err) => {
      // 本番でも debug できるように残す (transform-remove-console から console.warn は除外済)
      if (status === 'CHANNEL_ERROR') {
        console.warn(`[user-channel] ${userId} CHANNEL_ERROR`, err?.message);
      } else if (status === 'TIMED_OUT') {
        console.warn(`[user-channel] ${userId} TIMED_OUT`);
      } else if (status === 'SUBSCRIBED') {
        console.log(`[user-channel] ${userId} SUBSCRIBED`);
      }
    },
  );
}

// ============================================================
// useUserChannel — 上記の attach を app 起動時に 1 度だけ走らせる hook
// ============================================================
// app/_layout.tsx の RootLayout で 1 度呼ぶ。userId が変わったら再 attach。
// 子コンポーネントの個別 hook (useNotifications / useFeatureFlags / useBookmarks /
// useSavedSearches / useUserStamps) は **このチャンネルが live な前提で動く**。
// 同じ user で多重 mount しても attachChannel が refCount で共有するため安全。
// ============================================================
export function useUserChannel(): void {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);

  useEffect(() => {
    if (!userId) return;
    const detach = bindUserChannel(userId, qc);
    return () => {
      try {
        detach();
      } catch {
        // detach 失敗は cleanup 続行を妨げない
      }
    };
  }, [userId, qc]);
}
