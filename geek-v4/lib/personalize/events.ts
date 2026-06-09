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
import { pushAffinityDelta, AFFINITY_DELTA } from './syncAffinity';

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
// Schema validation (load-time)
// ----------------------------------------------------------------
// localStorage / AsyncStorage はクライアント側で任意に編集可能。
// JSON.parse 後にホワイトリスト型検証を行い、想定外データが
// recordEvent / scoring パイプラインに流れ込まないようにする。
//
// - kind は固定 whitelist 内のみ受理
// - tags は string[] (要素長 80 以下, 50 件以下)
// - 任意 string/number フィールドは想定型のみ通す
// - 全体は最大 LOAD_CAP 件で截断 (DoS / メモリ食いつぶし対策)
const VALID_KINDS: ReadonlySet<EventKind> = new Set<EventKind>([
  'post_view',
  'post_like',
  'post_save',
  'post_unlike',
  'post_concern',
  'post_hide',
  'thread_open',
  'thread_reply',
  'tag_click',
  'tag_block',
  'search_submit',
]);
const LOAD_CAP = 5000; // load 時の上限 (最新 N 件のみ保持)
const MAX_ID_LEN = 256;
const MAX_TAGS = 50;
const MAX_TAG_LEN = 80;
const MAX_STR_LEN = 512;

function isValidEvent(x: unknown): x is FeedEvent {
  if (!x || typeof x !== 'object') return false;
  const e = x as Record<string, unknown>;
  if (typeof e.id !== 'string' || e.id.length === 0 || e.id.length > MAX_ID_LEN) return false;
  if (typeof e.ts !== 'number' || !Number.isFinite(e.ts) || e.ts < 0) return false;
  if (typeof e.kind !== 'string' || !VALID_KINDS.has(e.kind as EventKind)) return false;
  if (!Array.isArray(e.tags)) return false;
  if (e.tags.length > MAX_TAGS) return false;
  if (!e.tags.every((t) => typeof t === 'string' && t.length <= MAX_TAG_LEN)) return false;
  if ('category' in e && e.category !== undefined) {
    if (typeof e.category !== 'string' || e.category.length > MAX_STR_LEN) return false;
  }
  if ('post_id' in e && e.post_id !== undefined) {
    if (typeof e.post_id !== 'string' || e.post_id.length > MAX_ID_LEN) return false;
  }
  if ('thread_id' in e && e.thread_id !== undefined) {
    if (typeof e.thread_id !== 'string' || e.thread_id.length > MAX_ID_LEN) return false;
  }
  if ('query' in e && e.query !== undefined) {
    if (typeof e.query !== 'string' || e.query.length > MAX_STR_LEN) return false;
  }
  if ('dwell_ms' in e && e.dwell_ms !== undefined) {
    if (typeof e.dwell_ms !== 'number' || !Number.isFinite(e.dwell_ms) || e.dwell_ms < 0) {
      return false;
    }
  }
  return true;
}

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
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      cache = [];
      return;
    }
    // schema validation: whitelist 型のみ受理 (localStorage 改竄対策)
    const validated = parsed.filter(isValidEvent);
    // 直近 LOAD_CAP 件にキャップ (DoS / メモリ食いつぶし対策)
    cache = validated.length > LOAD_CAP ? validated.slice(-LOAD_CAP) : validated;
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

    // サーバー側タグ親和性を即時更新 (Value Model シグナル)
    // fire-and-forget: 失敗は pushAffinityDelta 内で握り潰す
    if (tags.length > 0) {
      if (e.kind === 'post_like')    void pushAffinityDelta(tags, AFFINITY_DELTA.post_like);
      if (e.kind === 'post_save')    void pushAffinityDelta(tags, AFFINITY_DELTA.post_save);
      if (e.kind === 'post_unlike')  void pushAffinityDelta(tags, AFFINITY_DELTA.post_unlike);
      if (e.kind === 'post_concern') void pushAffinityDelta(tags, AFFINITY_DELTA.post_concern);
      if (e.kind === 'post_hide')    void pushAffinityDelta(tags, AFFINITY_DELTA.post_hide);
      if (e.kind === 'tag_click')    void pushAffinityDelta(tags, AFFINITY_DELTA.tag_click);
    }
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
