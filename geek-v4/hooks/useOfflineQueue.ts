// ============================================================
// useOfflineQueue — オフライン queue の processor + status hook
// ============================================================
// 役割:
//   1. networkMonitor を購読し、圏内復帰時に lib/offline/queue.processQueue を flush
//   2. 既存 hooks/useOfflineQueueProcessor (supabase 経路の legacy queue) も wrap
//      して、root で 1 回 mount するだけで両方とも回るようにする
//   3. UI 用の reactive status { pending, processing, failed } を返す
//
// 設計:
//   - 新規 queue (lib/offline/queue.ts) は executor を caller が渡す (= 依存逆転)。
//     ここでは「現状 enqueue する経路がまだ無い」ので、no-op executor を渡す。
//     将来 hooks/useLike / useConcern 等が新 queue を使うようになれば、その時に
//     executor を実装する。今 PR の range では既存 store 経路を維持する。
//   - 既存 useOfflineQueueProcessor の status (queue.length / processing) を
//     露出するために store を直接 select する。
// ============================================================

import { useEffect, useState } from 'react';
import {
  subscribeNetworkChange,
  isOnline,
  useNetworkStore,
} from '../lib/offline/networkMonitor';
import {
  processQueue,
  size as queueSize,
  deadSize,
  type ExecuteFn,
} from '../lib/offline/queue';
import { useOfflineQueueProcessor } from './useOfflineQueueProcessor';
import { useOfflineQueueStore } from '../stores/offlineQueueStore';
import { swallow } from '../lib/swallow';

export type OfflineQueueStatus = {
  pending: number;
  processing: boolean;
  failed: number;
  online: boolean;
};

// 新 queue 用 executor — 今 PR では caller (enqueue する hook) がまだ存在しないので
// no-op。将来「post_create を圏外で受け付ける」等の経路が増えたら、ここに dispatch
// table を追加して supabase 呼び出しを実装する。
const noopExecute: ExecuteFn = async () => {
  /* no-op: 今 PR の range では新 queue を使う enqueuer が無い */
};

export function useOfflineQueue(): OfflineQueueStatus {
  // 既存 legacy queue processor も 1 回起動する (root 1 回 mount で済むよう統合)
  useOfflineQueueProcessor();

  const online = useNetworkStore((s) => s.online);
  const legacyPending = useOfflineQueueStore((s) => s.queue.length);
  const legacyFailed = useOfflineQueueStore(
    (s) => s.queue.filter((q) => q.attempts > 0).length,
  );

  const [newPending, setNewPending] = useState<number>(() => {
    try {
      return queueSize();
    } catch {
      return 0;
    }
  });
  const [newFailed, setNewFailed] = useState<number>(() => {
    try {
      return deadSize();
    } catch {
      return 0;
    }
  });
  const [processing, setProcessing] = useState(false);

  // networkMonitor 購読: 圏内復帰で新 queue を flush
  useEffect(() => {
    const unsub = subscribeNetworkChange((nowOnline) => {
      if (!nowOnline) return;
      void flush();
    });
    // 初回 mount で既に online なら 1 回 flush を試す
    if (isOnline()) {
      void flush();
    }
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function flush() {
    if (processing) return;
    setProcessing(true);
    try {
      const r = await processQueue(noopExecute);
      // 状態を最新化
      setNewPending(queueSize());
      setNewFailed(deadSize());
      // r は debug 用に return されているが今は使わない (executor が no-op のため
      // 0 になる想定)。
      void r;
    } catch (e) {
      swallow('useOfflineQueue.flush', e);
    } finally {
      setProcessing(false);
    }
  }

  return {
    pending: legacyPending + newPending,
    processing,
    failed: legacyFailed + newFailed,
    online,
  };
}
