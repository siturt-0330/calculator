// ============================================================
// hooks/useFeedRealtime.ts
// ------------------------------------------------------------
// feed.tsx で表示中の postIds に対する Realtime subscription を 1 箇所に集約。
//
// なぜ必要か:
//   useReactions(legacyIds) の中にだけ realtime subscription があったが、
//   feed.tsx は通常 useFeedPage (RPC) を使うので legacyIds=[] となり
//   subscription が disabled になっていた。結果:
//     - 他人がリアクションしても自分の画面では反映されない
//     - 自分の click は optimistic で反映されるが、別端末を開いていると
//       そっちには届かない (タブ切替で初めて refetch される)
//
//   このフックは postIds (= 現在表示中の post 集合) を見て、常に
//   post_reactions / likes / concerns / saves の変更を購読する。
//   イベント到着時は invalidateFeedPage で RPC cache を refetch させる。
//
//   debounce (300ms) で「短時間に大量のイベントが来た時の連続 refetch」を抑制。
// ============================================================

import { useEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { attachChannel } from '../lib/realtime';
import { stableKeyFor } from '../lib/utils/queryKey';
import { invalidateFeedPage } from '../lib/cacheUpdates/feedPagePatcher';

// Supabase Realtime の per-filter 上限 (PostgrestFilterBuilder 同様 in() で送る ids)
// あまり長い filter は server-side で reject されるので safety cap を設ける
const MAX_FILTER_IDS = 30;

// 連続イベントの debounce (ms) — クリック直後の DELETE+INSERT を 1 回に
const DEBOUNCE_MS = 300;

export function useFeedRealtime(postIds: string[]): void {
  const qc = useQueryClient();

  // postIds の中身に依存して安定化する key (中身が同じなら参照不変)
  const sortedKey = useMemo(
    () => stableKeyFor(postIds.slice().sort()),
    [postIds],
  );

  // debounce timer
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 最新の qc を ref で参照 (effect の依存を sortedKey だけに保つため)
  const qcRef = useRef(qc);
  qcRef.current = qc;

  useEffect(() => {
    if (postIds.length === 0) return;

    const serverIds = postIds.slice(0, MAX_FILTER_IDS);
    const idSet = new Set(postIds);
    const filter = `post_id=in.(${serverIds.join(',')})`;
    const channelName = `feed-realtime:${sortedKey.slice(0, 64)}`;

    const triggerInvalidate = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        // RPC cache だけ refetch — legacy cache 群は対応する hook が
        // それぞれ別途 staleTime で扱う (refetch コストの二重発生防止)
        invalidateFeedPage(qcRef.current);
      }, DEBOUNCE_MS);
    };

    const handlePayload = (payload: { new?: unknown; old?: unknown }) => {
      const row = (payload.new ?? payload.old) as { post_id?: string } | null;
      if (!row?.post_id || !idSet.has(row.post_id)) return;
      triggerInvalidate();
    };

    const detach = attachChannel(channelName, (ch) =>
      ch
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'post_reactions', filter },
          handlePayload,
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'likes', filter },
          handlePayload,
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'concerns', filter },
          handlePayload,
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'saves', filter },
          handlePayload,
        ),
    );

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      detach();
    };
    // postIds は中身が変わると sortedKey が変わるので、それだけを依存に
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedKey]);
}
