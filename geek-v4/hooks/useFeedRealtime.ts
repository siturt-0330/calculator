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
// ★ 設計判断の変遷:
//   2026-05-24: 1 channel に post_reactions / likes / concerns / saves を chain
//   していたが、concerns/saves が publication 未登録で CHANNEL_ERROR cascade →
//   1 テーブル/1 channel に分離。
//
//   2026-05-28 (Audit E#5): post_reactions と likes は **両方とも** publication
//   登録済 (migration 0008) で確認済のため、1 channel + 2 `.on()` に再統合。
//   CLAUDE.md § 5.3 の cascade リスクは「publication 未登録 table が混ざる」場合
//   だけで、両方登録済なら 1 channel に集約しても安全。feed 描画時の同時 channel
//   数を絞るための統合 (2 → 1)。
//   将来未登録 table を増やすなら、その table だけ別 channel に分離する。
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

// 購読対象テーブル。
// publication 0008 で supabase_realtime に登録済みのものだけ。
// (concerns / saves は publication 未登録なので除外。優先度が上がったら別 PR で追加 migration)
const TABLES = ['post_reactions', 'likes'] as const;

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
    // channel name を sortedKey の頭で軽くハッシュ (長すぎる name は接続 reject される)
    const baseName = sortedKey.slice(0, 32);

    const triggerInvalidate = (table: string) => {
      console.log(`[feed-realtime] event from ${table} → invalidate queued`);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        // RPC cache だけ refetch — legacy cache 群は対応する hook が
        // それぞれ別途 staleTime で扱う (refetch コストの二重発生防止)
        invalidateFeedPage(qcRef.current);
      }, DEBOUNCE_MS);
    };

    const handlePayload = (table: string) => (payload: { new?: unknown; old?: unknown }) => {
      const row = (payload.new ?? payload.old) as { post_id?: string } | null;
      if (!row?.post_id || !idSet.has(row.post_id)) return;
      triggerInvalidate(table);
    };

    // ★ 1 channel + N `.on()` bundle (両 table とも publication 登録済 = 安全)
    const channelName = `feed-rt:${baseName}`;
    const detach = attachChannel(
      channelName,
      (ch) => {
        let chain = ch;
        for (const table of TABLES) {
          chain = chain.on(
            'postgres_changes',
            { event: '*', schema: 'public', table, filter },
            handlePayload(table),
          );
        }
        return chain;
      },
      (status, err) => {
        // 本番でも debug 容易 — "realtime 効いてない" の即時切り分けに必須。
        // console.warn / .error は babel の transform-remove-console から除外設定済み。
        if (status === 'SUBSCRIBED') {
          console.log(`[feed-realtime] bundle SUBSCRIBED (${TABLES.length} tables, ${serverIds.length} ids)`);
        } else if (status === 'CHANNEL_ERROR') {
          console.warn(`[feed-realtime] bundle CHANNEL_ERROR`, err?.message);
        } else if (status === 'TIMED_OUT') {
          console.warn(`[feed-realtime] bundle TIMED_OUT`);
        } else if (status === 'CLOSED') {
          console.log(`[feed-realtime] bundle CLOSED`);
        }
      },
    );

    return () => {
      // ★ timer を必ず clear + null 化 (unmount 後の fire 防止)
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      try {
        detach();
      } catch {
        // detach の失敗は cleanup 続行を妨げない
      }
    };
    // postIds は中身が変わると sortedKey が変わるので、それだけを依存に
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedKey]);
}
