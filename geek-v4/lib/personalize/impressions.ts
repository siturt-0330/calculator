// ============================================================
// lib/personalize/impressions.ts — フィード閲覧履歴記録
// ============================================================
// Instagram の「再閲覧抑制」機能を Supabase で実現する。
// フィードで表示された投稿 ID を post_impressions テーブルに記録し、
// get_for_you_feed RPC が同じ投稿を繰り返し表示しないようにする。
//
// 使い方:
//   - FlashList の onViewableItemsChanged: recordImpression(item.id)
//   - アプリ終了/バックグラウンド: flushImpressions()
//
// 設計:
//   - クライアント側バッファリング (Set で重複除去)
//   - 20件または30秒で自動フラッシュ
//   - fail-silent (非クリティカル)
// ============================================================

import { supabase } from '../supabase';

const FLUSH_INTERVAL_MS = 30_000;
const FLUSH_THRESHOLD = 20;

const pendingIds = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushNow().catch(() => {});
  }, FLUSH_INTERVAL_MS);
}

async function flushNow(): Promise<void> {
  if (pendingIds.size === 0) return;
  const ids = Array.from(pendingIds).slice(0, 100);
  for (const id of ids) pendingIds.delete(id);
  try {
    const { error } = await supabase.rpc('record_impression_batch', { p_post_ids: ids });
    if (error && __DEV__) console.warn('[impressions] flushNow:', error.message);
  } catch (e) {
    if (__DEV__) console.warn('[impressions] flushNow exception:', e);
  }
}

// フィードで投稿が表示されたときに呼ぶ
export function recordImpression(postId: string): void {
  if (!postId) return;
  pendingIds.add(postId);
  if (pendingIds.size >= FLUSH_THRESHOLD) {
    flushNow().catch(() => {});
    return;
  }
  scheduleFlush();
}

// アプリ終了/バックグラウンド時に残りを送信
export async function flushImpressions(): Promise<void> {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flushNow();
}
