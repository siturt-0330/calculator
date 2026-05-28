// ============================================================
// Offline Mutation Queue
// ============================================================
// 圏外時に発生した「副作用ありの mutation」を永続化し、圏内復帰時に
// 順次再送するための queue。読み取り (GET) は React Query persist の
// cache から返るので、ここでは扱わない。
//
// 設計:
//   - 永続層は `lib/storage.ts` (MMKV native / localStorage web 同期 wrapper)
//   - dedupe: 同種 + 同 payload (JSON 化) なら enqueue を no-op
//   - 上限: MAX_ITEMS=100。超えたら oldest を捨て warn
//   - retryCount: MAX_ATTEMPTS=3 で dead letter に移送
//   - dead letter は別 key で永続化 (UI でいつか可視化できるよう)
//
// 既存:
//   - stores/offlineQueueStore.ts と hooks/useOfflineQueueProcessor.ts が
//     現役で動いている。こちらの queue は「より一般的な再送基盤」として並列に
//     提供し、必要に応じて移行できる形にしておく。既存 store は壊さない。
//
// 注意:
//   - executeAction は **caller が注入する** (lib/offline/queue.ts 自体は
//     supabase 等に依存しない)。これによりユニットテスト容易性 + 循環依存
//     回避を両立する。
// ============================================================

import { getJson, setJson, remove } from '../storage';
import { swallow } from '../swallow';

// ----- 型 -----

export type QueueItemKind =
  | 'post_create'
  | 'comment_create'
  | 'reaction'
  | 'like'
  | 'concern'
  | 'reply_create';

export type QueueItem = {
  id: string;
  kind: QueueItemKind;
  payload: Record<string, unknown>;
  createdAt: number;
  retryCount: number;
};

export type DeadLetterItem = QueueItem & {
  failedAt: number;
  reason: string;
};

export type QueueSnapshot = {
  pending: QueueItem[];
  dead: DeadLetterItem[];
};

export type ExecuteFn = (item: QueueItem) => Promise<void>;

// ----- 設定 -----
const QUEUE_KEY = 'geek:offline_queue_v2';
const DEAD_KEY = 'geek:offline_queue_v2_dead';
export const MAX_ITEMS = 100;
export const MAX_RETRIES = 3;

// ----- 内部ヘルパ -----

function safeKey(kind: QueueItemKind, payload: Record<string, unknown>): string {
  try {
    // payload は JSON-serializable 前提。order を揃えるため key sort。
    return `${kind}::${stableStringify(payload)}`;
  } catch {
    return `${kind}::${Math.random()}`;
  }
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map((x) => stableStringify(x)).join(',')}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function genId(kind: QueueItemKind): string {
  return `${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ----- 永続化 -----

export function loadQueue(): QueueItem[] {
  return getJson<QueueItem[]>(QUEUE_KEY) ?? [];
}

function saveQueue(q: QueueItem[]): void {
  try {
    setJson<QueueItem[]>(QUEUE_KEY, q);
  } catch (e) {
    swallow('offlineQueue.save', e);
  }
}

export function loadDeadLetter(): DeadLetterItem[] {
  return getJson<DeadLetterItem[]>(DEAD_KEY) ?? [];
}

function saveDeadLetter(q: DeadLetterItem[]): void {
  try {
    setJson<DeadLetterItem[]>(DEAD_KEY, q);
  } catch (e) {
    swallow('offlineQueue.saveDead', e);
  }
}

// ----- enqueue / dequeue -----

/**
 * 新しい item を queue に追加する。
 * - 同種 + 同 payload が既にあれば skip (return existing id)
 * - 上限超過時は oldest を捨てて warn
 */
export function enqueue(kind: QueueItemKind, payload: Record<string, unknown>): string {
  const cur = loadQueue();
  const k = safeKey(kind, payload);
  const existing = cur.find((it) => safeKey(it.kind, it.payload) === k);
  if (existing) return existing.id;

  const item: QueueItem = {
    id: genId(kind),
    kind,
    payload,
    createdAt: Date.now(),
    retryCount: 0,
  };

  let next = [...cur, item];
  if (next.length > MAX_ITEMS) {
    const dropped = next.length - MAX_ITEMS;
    // 古い方から drop
    next = next.slice(dropped);
    // eslint-disable-next-line no-console
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn(`[offlineQueue] dropped ${dropped} oldest items (> ${MAX_ITEMS})`);
    }
  }
  saveQueue(next);
  return item.id;
}

export function dequeue(id: string): void {
  const cur = loadQueue();
  const next = cur.filter((it) => it.id !== id);
  saveQueue(next);
}

export function clearQueue(): void {
  try {
    remove(QUEUE_KEY);
  } catch (e) {
    swallow('offlineQueue.clear', e);
  }
}

export function clearDeadLetter(): void {
  try {
    remove(DEAD_KEY);
  } catch (e) {
    swallow('offlineQueue.clearDead', e);
  }
}

// ----- 実行 -----

/**
 * queue を頭から順に実行する。
 * - 各 item に対して execute(item) を await
 * - 成功 → dequeue
 * - 失敗 → retryCount++; 上限超えで dead letter
 * - 順番は createdAt 昇順 (push 順)
 * - 戻り値: { processed, failed, dead }
 */
export async function processQueue(
  execute: ExecuteFn,
): Promise<{ processed: number; failed: number; dead: number }> {
  // snapshot を取って iterate (永続層の中身は都度 reload する — 並列 enqueue を許す)
  const initial = loadQueue();
  let processed = 0;
  let failed = 0;
  let dead = 0;

  for (const item of initial) {
    // 最新状態を再 load してまだ残っているか確認
    const live = loadQueue().find((it) => it.id === item.id);
    if (!live) continue;
    try {
      await execute(live);
      dequeue(live.id);
      processed += 1;
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      const updated: QueueItem = { ...live, retryCount: live.retryCount + 1 };
      if (updated.retryCount >= MAX_RETRIES) {
        // dead letter へ移送
        const deadCur = loadDeadLetter();
        const deadItem: DeadLetterItem = {
          ...updated,
          failedAt: Date.now(),
          reason: reason.slice(0, 200),
        };
        saveDeadLetter([...deadCur, deadItem]);
        dequeue(updated.id);
        dead += 1;
      } else {
        // retry: 永続層に書き戻す
        const q = loadQueue().map((it) => (it.id === updated.id ? updated : it));
        saveQueue(q);
        failed += 1;
      }
    }
  }

  return { processed, failed, dead };
}

// ----- 観測用 helper -----

export function getSnapshot(): QueueSnapshot {
  return {
    pending: loadQueue(),
    dead: loadDeadLetter(),
  };
}

export function size(): number {
  return loadQueue().length;
}

export function deadSize(): number {
  return loadDeadLetter().length;
}
