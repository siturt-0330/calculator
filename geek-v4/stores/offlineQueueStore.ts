// ============================================================
// Offline Action Queue
// ============================================================
// オフライン中に発生したミューテーションを永続化し、復活時に再実行。
//
// サポートする action 種類:
//   - like / unlike
//   - reaction (post_reactions)
//   - bbs_reply (掲示板の返信)
//   - comment
//
// 実行は idempotent でなければならない (同じアクションを2度実行しても安全)。
// ============================================================

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'geek:offline_queue_v1';

export type QueuedAction = {
  id: string;             // クライアント生成 UUID
  type: 'like' | 'unlike' | 'reaction_add' | 'reaction_remove' | 'comment' | 'bbs_reply';
  payload: Record<string, unknown>;
  attempts: number;
  enqueuedAt: number;
  lastTriedAt?: number;
};

export type OfflineQueueState = {
  queue: QueuedAction[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  enqueue: (type: QueuedAction['type'], payload: Record<string, unknown>) => void;
  dequeue: (id: string) => void;
  markAttempt: (id: string) => void;
  clear: () => void;
};

function save(q: QueuedAction[]) {
  try {
    AsyncStorage.setItem(KEY, JSON.stringify(q)).catch(() => {});
  } catch {}
}

export const useOfflineQueueStore = create<OfflineQueueState>((set, get) => ({
  queue: [],
  hydrated: false,

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw) {
        const q = JSON.parse(raw) as QueuedAction[];
        set({ queue: q, hydrated: true });
        return;
      }
    } catch {}
    set({ hydrated: true });
  },

  enqueue: (type, payload) => {
    const item: QueuedAction = {
      id: `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      payload,
      attempts: 0,
      enqueuedAt: Date.now(),
    };
    const next = [...get().queue, item];
    set({ queue: next });
    save(next);
  },

  dequeue: (id) => {
    const next = get().queue.filter((q) => q.id !== id);
    set({ queue: next });
    save(next);
  },

  markAttempt: (id) => {
    const next = get().queue.map((q) =>
      q.id === id ? { ...q, attempts: q.attempts + 1, lastTriedAt: Date.now() } : q,
    );
    set({ queue: next });
    save(next);
  },

  clear: () => {
    set({ queue: [] });
    save([]);
  },
}));
