// ============================================================
// Personalization — on-device behavior event log
// ============================================================
// このモジュールはユーザーの行動シグナル (タップ・閲覧・いいね 等) を
// 端末ローカルにのみ保存する。サーバーには絶対に送信しない。
//
// - capped FIFO: 最新 1000 件を保持
// - debounced writes: 500ms 内の複数イベントを 1 回の書き込みにまとめる
// - never throws: 失敗は console.warn で握り潰す (非クリティカル)
// - storage: native は AsyncStorage、web は localStorage
// ============================================================

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { deepNormalize } from '../search/tokenize';

export type EventKind =
  | 'post_view'
  | 'post_like'
  | 'post_save'
  | 'post_unlike'
  | 'post_concern'
  | 'post_hide'
  | 'thread_open'
  | 'thread_reply'
  | 'tag_click'
  | 'tag_block'
  | 'search_submit';

export type FeedEvent = {
  id: string;
  ts: number;
  kind: EventKind;
  tags: string[];
  category?: string;
  post_id?: string;
  thread_id?: string;
  query?: string;
  dwell_ms?: number;
};

const STORAGE_KEY = 'geek:personalize:events:v1';
const MAX_EVENTS = 1000;
const DROP_BATCH = 100; // 1000 を超えたら最古 100 を捨てる
const DEBOUNCE_MS = 500;

// ----------------------------------------------------------------
// Storage adapter (web / native)
// ----------------------------------------------------------------
async function rawGet(key: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      return window.localStorage.getItem(key);
    }
    return await AsyncStorage.getItem(key);
  } catch (e) {
    console.warn('[personalize/events] get failed:', e);
    return null;
  }
}

async function rawSet(key: string, value: string): Promise<void> {
  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.localStorage.setItem(key, value);
      return;
    }
    await AsyncStorage.setItem(key, value);
  } catch (e) {
    console.warn('[personalize/events] set failed:', e);
  }
}

async function rawRemove(key: string): Promise<void> {
  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.localStorage.removeItem(key);
      return;
    }
    await AsyncStorage.removeItem(key);
  } catch (e) {
    console.warn('[personalize/events] remove failed:', e);
  }
}

// ----------------------------------------------------------------
// UUID / fallback id
// ----------------------------------------------------------------
function makeId(): string {
  try {
    const c: { randomUUID?: () => string } | undefined =
      typeof globalThis !== 'undefined'
        ? (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto
        : undefined;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  } catch {
    // fallthrough
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ----------------------------------------------------------------
// In-memory cache + write debounce queue
// ----------------------------------------------------------------
let cache: FeedEvent[] | null = null;
let pendingWrites: FeedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let initPromise: Promise<void> | null = null;

async function loadCache(): Promise<void> {
  if (cache !== null) return;
  const raw = await rawGet(STORAGE_KEY);
  if (!raw) {
    cache = [];
    return;
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      // sanity filter: each entry has id, ts, kind, tags
      cache = parsed.filter(
        (e: unknown): e is FeedEvent =>
          !!e &&
          typeof e === 'object' &&
          typeof (e as FeedEvent).id === 'string' &&
          typeof (e as FeedEvent).ts === 'number' &&
          typeof (e as FeedEvent).kind === 'string' &&
          Array.isArray((e as FeedEvent).tags),
      );
    } else {
      cache = [];
    }
  } catch (e) {
    console.warn('[personalize/events] parse failed, resetting:', e);
    cache = [];
  }
}

async function ensureLoaded(): Promise<void> {
  if (cache !== null) return;
  if (initPromise === null) initPromise = loadCache();
  await initPromise;
}

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, DEBOUNCE_MS);
}

async function flush(): Promise<void> {
  if (pendingWrites.length === 0) return;
  await ensureLoaded();
  const current = cache ?? [];
  const merged = current.concat(pendingWrites);
  pendingWrites = [];

  // cap: when over MAX, drop oldest DROP_BATCH
  let next = merged;
  if (next.length > MAX_EVENTS) {
    const overflow = next.length - (MAX_EVENTS - DROP_BATCH);
    next = next.slice(overflow);
  }
  cache = next;
  await rawSet(STORAGE_KEY, JSON.stringify(next));
}

// ----------------------------------------------------------------
// Public API
// ----------------------------------------------------------------
export async function logEvent(e: Omit<FeedEvent, 'id' | 'ts'>): Promise<void> {
  try {
    const tags = (e.tags ?? []).map((t) => deepNormalize(t)).filter((t) => t.length > 0);
    const ev: FeedEvent = {
      id: makeId(),
      ts: Date.now(),
      kind: e.kind,
      tags,
    };
    if (e.category !== undefined) ev.category = e.category;
    if (e.post_id !== undefined) ev.post_id = e.post_id;
    if (e.thread_id !== undefined) ev.thread_id = e.thread_id;
    if (e.query !== undefined) ev.query = e.query;
    if (e.dwell_ms !== undefined) ev.dwell_ms = e.dwell_ms;

    pendingWrites.push(ev);
    scheduleFlush();
  } catch (err) {
    console.warn('[personalize/events] logEvent failed:', err);
  }
}

export async function getEvents(): Promise<FeedEvent[]> {
  try {
    // force any pending writes through first so callers see consistent state
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
      await flush();
    } else if (pendingWrites.length > 0) {
      await flush();
    }
    await ensureLoaded();
    return (cache ?? []).slice();
  } catch (e) {
    console.warn('[personalize/events] getEvents failed:', e);
    return [];
  }
}

export async function clearEvents(): Promise<void> {
  try {
    cache = [];
    pendingWrites = [];
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    await rawRemove(STORAGE_KEY);
  } catch (e) {
    console.warn('[personalize/events] clearEvents failed:', e);
  }
}

export async function getEventCount(): Promise<number> {
  try {
    await ensureLoaded();
    return (cache?.length ?? 0) + pendingWrites.length;
  } catch (e) {
    console.warn('[personalize/events] getEventCount failed:', e);
    return 0;
  }
}
