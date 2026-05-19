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
// ============================================================

type ChannelBuilder = (channel: RealtimeChannel) => RealtimeChannel;

type Entry = {
  channel: RealtimeChannel;
  refCount: number;
};

const channels = new Map<string, Entry>();

// DoS 防止: 1 セッションあたりの同時 channel 数を制限
// Supabase Realtime の per-connection 上限よりも前にクライアント側で reject
const MAX_CONCURRENT_CHANNELS = 20;

// 指定 name の channel に対し subscribe (初回のみ) + refCount を増やす。
// 戻り値の関数を呼ぶと refCount を減らし、ゼロになったら channel を破棄する。
export function attachChannel(name: string, build: ChannelBuilder): () => void {
  const existing = channels.get(name);
  if (existing) {
    existing.refCount++;
    return () => detachChannel(name);
  }
  // 上限到達: 警告だけ出して何もしない (戻り値は no-op detacher)
  if (channels.size >= MAX_CONCURRENT_CHANNELS) {
    console.warn(`[realtime] channel limit reached (${MAX_CONCURRENT_CHANNELS}). Skipping subscription for "${name}".`);
    return () => {};
  }
  // 新規 channel を作成 → builder で .on(...) を全部チェーン → subscribe
  const ch = build(supabase.channel(name));
  ch.subscribe();
  channels.set(name, { channel: ch, refCount: 1 });
  return () => detachChannel(name);
}

// 全 channel を強制的に detach (logout 時など)
export function detachAllChannels() {
  for (const [name, entry] of channels) {
    void supabase.removeChannel(entry.channel);
    channels.delete(name);
  }
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
