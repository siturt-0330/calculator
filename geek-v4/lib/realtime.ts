import { supabase } from './supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

// ============================================================
// Realtime channel singleton manager
// ============================================================
// 複数の React コンポーネントが同じ channel 名で subscribe しようとすると、
// Supabase Client は同名 channel を再利用するため、2回目以降の `.on()` 呼び出しが
// 「subscribe 後の追加は不可」で全て失敗していた。
//
// このヘルパーは channel 名で refCount を管理し、最初の attach のみが実際に
// subscribe する。2 回目以降は既存 channel を共有する。
//
// ★ Connection pool 枯渇対策 (2026-05):
//   CHANNEL_ERROR / TIMED_OUT / CLOSED になった channel が refCount で居続けると、
//   別 component が同名 attach しても "dead channel" を再利用してしまい、
//   subscribe しない / event 来ない / server 側 connection は open のまま、になる。
//   → status callback 内で dead 判定 → Map から削除 + removeChannel で自動回収。
// ============================================================

type ChannelBuilder = (channel: RealtimeChannel) => RealtimeChannel;
// subscribe status の通知コールバック (SUBSCRIBED / CHANNEL_ERROR / TIMED_OUT / CLOSED)
// 失敗した channel を観測できると "realtime 来てない" の debug が桁違いに楽になる。
export type RealtimeStatus = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED';
export type StatusCallback = (status: RealtimeStatus, err?: Error) => void;

type Entry = {
  channel: RealtimeChannel;
  refCount: number;
  lastAttachAt: number;
};

const channels = new Map<string, Entry>();

// DoS 防止: 1 セッションあたりの同時 channel 数を制限
// Supabase Realtime の per-connection 上限よりも前にクライアント側で reject
// 20 は緩すぎた (10 user で Free tier 200 connection を食い潰す) ので 12 に絞る。
const MAX_CONCURRENT_CHANNELS = 12;

// dead 判定する subscribe status
const DEAD_STATUSES: ReadonlySet<RealtimeStatus> = new Set([
  'CHANNEL_ERROR',
  'TIMED_OUT',
  'CLOSED',
]);

// 指定 name の channel に対し subscribe (初回のみ) + refCount を増やす。
// 戻り値の関数を呼ぶと refCount を減らし、ゼロになったら channel を破棄する。
//
// onStatus を渡すと subscribe ライフサイクル (成功/失敗/timeout/close) を観測できる。
// 同 name の 2 回目以降の attach では onStatus は呼ばれない (既存 channel を共有)。
export function attachChannel(
  name: string,
  build: ChannelBuilder,
  onStatus?: StatusCallback,
): () => void {
  const existing = channels.get(name);
  if (existing) {
    existing.refCount++;
    existing.lastAttachAt = Date.now();
    return () => detachChannel(name);
  }
  // 上限到達: 警告だけ出して何もしない (戻り値は no-op detacher)
  if (channels.size >= MAX_CONCURRENT_CHANNELS) {
    console.warn(`[realtime] channel limit reached (${MAX_CONCURRENT_CHANNELS}). Skipping subscription for "${name}".`);
    return () => {};
  }
  // 新規 channel を作成 → builder で .on(...) を全部チェーン → subscribe
  const ch = build(supabase.channel(name));
  ch.subscribe((status, err) => {
    const s = status as RealtimeStatus;
    // ユーザー指定 callback は status を必ず先に転送 (既存 behavior を保つ)
    if (onStatus) {
      try {
        onStatus(s, err);
      } catch (e) {
        // callback の例外は auto-detach を止めない
        console.warn('[realtime] onStatus callback threw:', e);
      }
    }
    // dead channel は entry を Map から除去 + server 側 connection も close
    if (DEAD_STATUSES.has(s)) {
      const current = channels.get(name);
      // 同一 channel instance のみ削除 (再 attach で新 channel に置換済みなら触らない)
      if (current && current.channel === ch) {
        console.warn('[realtime] auto-detach dead channel:', name, s);
        channels.delete(name);
        void supabase.removeChannel(ch);
      }
    }
  });
  channels.set(name, { channel: ch, refCount: 1, lastAttachAt: Date.now() });
  return () => detachChannel(name);
}

// 全 channel を強制的に detach (logout 時など)
export function detachAllChannels() {
  for (const [name, entry] of channels) {
    void supabase.removeChannel(entry.channel);
    channels.delete(name);
  }
}

// 古い channel を強制掃除 (logout / app foreground 復帰時など)。
// 最終 attach から thresholdMs 以上経過している channel を removeChannel + Map から削除。
// 戻り値: 掃除した channel 数。
export function gcStaleChannels(thresholdMs = 5 * 60_000): number {
  const now = Date.now();
  let removed = 0;
  for (const [name, entry] of channels) {
    if (now - entry.lastAttachAt >= thresholdMs) {
      console.warn('[realtime] gc stale channel:', name, `age=${now - entry.lastAttachAt}ms`);
      void supabase.removeChannel(entry.channel);
      channels.delete(name);
      removed++;
    }
  }
  return removed;
}

// デバッグ用: 現在の channel 数と状態を返す (hooks / dev tools から参照)
export function getChannelStats(): { count: number; names: string[]; max: number } {
  return {
    count: channels.size,
    names: Array.from(channels.keys()),
    max: MAX_CONCURRENT_CHANNELS,
  };
}

function detachChannel(name: string) {
  const entry = channels.get(name);
  if (!entry) return;
  entry.refCount--;
  if (entry.refCount <= 0) {
    void supabase.removeChannel(entry.channel);
    channels.delete(name);
  }
}
