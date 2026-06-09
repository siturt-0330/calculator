// ============================================================
// lib/personalize/syncAffinity.ts — サーバー側タグ親和性同期
// ============================================================
// Instagram Two-Tower の「ユーザーベクトル」を Supabase に反映する。
// クライアントの MMKV タグ履歴 (tagAffinity) を user_tag_affinity テーブルに
// 定期同期し、get_for_you_feed RPC がサーバー側でタグ親和性を使えるようにする。
//
// 使い方:
//   - アプリ起動時: syncAffinityOnStartup(profile.tagAffinity) を1回呼ぶ
//   - いいね/保存/懸念後: pushAffinityDelta(tags, AFFINITY_DELTA.post_like) を呼ぶ
//   - 全て fail-silent (非クリティカル処理)
// ============================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../supabase';
import { deepNormalize } from '../search/tokenize';

const LAST_SYNC_KEY = 'geek:personalize:affinity_sync_at:v1';
const SYNC_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12h に1回同期

// Value Model のシグナル重み (サーバー側 upsert_tag_affinity の p_delta に対応)
export const AFFINITY_DELTA = {
  post_like: 3.0,
  post_save: 2.0,
  post_view_long: 1.0,
  tag_click: 1.5,
  post_unlike: -2.0,
  post_concern: -3.0,
  post_hide: -4.0,
} as const;

export type AffinityDeltaKind = keyof typeof AFFINITY_DELTA;

function normalizeTags(tags: string[]): string[] {
  return tags
    .map((t) => deepNormalize(t))
    .filter((t) => t.length > 0 && t.length <= 100)
    .slice(0, 50);
}

// サーバーにタグ親和性の増分更新を送信 (fail-silent)
export async function pushAffinityDelta(
  tags: string[],
  delta: number,
): Promise<void> {
  if (tags.length === 0) return;
  const normed = normalizeTags(tags);
  if (normed.length === 0) return;
  try {
    const { error } = await supabase.rpc('upsert_tag_affinity', {
      p_tag_names: normed,
      p_delta: delta,
    });
    if (error && __DEV__) console.warn('[syncAffinity] pushAffinityDelta:', error.message);
  } catch (e) {
    if (__DEV__) console.warn('[syncAffinity] pushAffinityDelta exception:', e);
  }
}

// 起動時の全量同期 (MMKV tagAffinity → server)
// 12h に1回のみ実行 (AsyncStorage で前回同期時刻を管理)
export async function syncAffinityOnStartup(
  tagAffinity: Record<string, number>,
): Promise<void> {
  try {
    const lastStr = await AsyncStorage.getItem(LAST_SYNC_KEY);
    if (lastStr) {
      const last = parseInt(lastStr, 10);
      if (Number.isFinite(last) && Date.now() - last < SYNC_INTERVAL_MS) return;
    }
  } catch {
    // storage 失敗 → 同期実行
  }

  const entries = Object.entries(tagAffinity)
    .filter(([, v]) => Number.isFinite(v) && v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50);

  if (entries.length === 0) return;

  // 25件ずつバッチ送信 (RPC 配列サイズ上限対応)
  const BATCH = 25;
  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    const tags = batch.map(([t]) => t);
    await pushAffinityDelta(tags, 1.0);
  }

  try {
    await AsyncStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}
