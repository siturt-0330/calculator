// ============================================================
// 既読/未読ハイライト用 lastViewed タイムスタンプ
// ------------------------------------------------------------
// post / thread / community などの「最後に開いた時刻」を保存し、
// 再訪時に「それより新しい子要素 (コメント・返信) を未読としてハイライト」
// するための薄い helper。
//
// 設計:
//   - storage は lib/storage.ts (MMKV native / localStorage web) を経由
//     → window.localStorage を直接叩かない (SSR / 例外 safe)
//   - scope を分けることで「同じ id でも別領域なら別 key」になる
//     (例: post と thread と community が同 UUID でも衝突しない)
//   - 値は epoch ms (Number)。getString → Number で parse する
//     (storage.set(key, number) は文字列化される)
//   - 不正値 (NaN / 過去すぎる sentinel) は null で返す
//
// 注意:
//   - 「未読」かどうかの判定は本ファイルでは行わない (caller 側で比較する)。
//     getLastViewed() === null なら「初訪問」として扱う。
//   - clearLastViewed(scope, id) も提供 — 設定画面等で「既読リセット」を
//     行いたい場合に使う。
// ============================================================

import { getString, setString, remove } from '../storage';

export type LastViewedScope = 'post' | 'thread' | 'community';

const KEY_PREFIX = 'geekv4_';
const KEY_SUFFIX = '_lastviewed_';

/** 内部: storage key を組み立てる (scope と id を含む) */
function buildKey(scope: LastViewedScope, id: string): string {
  return `${KEY_PREFIX}${scope}${KEY_SUFFIX}${id}`;
}

/**
 * 保存された lastViewed 時刻を返す (epoch ms)。
 * 未保存 / 不正値の場合は null。
 */
export function getLastViewed(scope: LastViewedScope, id: string): number | null {
  if (!id) return null;
  const raw = getString(buildKey(scope, id));
  if (raw === undefined) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * 現在時刻 (Date.now()) を lastViewed として保存する。
 * 失敗は swallow (storage.ts 側で握りつぶされる)。
 */
export function setLastViewed(scope: LastViewedScope, id: string): void {
  if (!id) return;
  setString(buildKey(scope, id), String(Date.now()));
}

/**
 * lastViewed を消す (= 「未読扱いに戻す」)。
 * 主に test や 設定画面の「既読リセット」用。
 */
export function clearLastViewed(scope: LastViewedScope, id: string): void {
  if (!id) return;
  remove(buildKey(scope, id));
}

/**
 * 「created_at が lastViewed より新しい = 未読」 判定 helper。
 *
 * @param createdAt ISO 文字列 or epoch ms (number)
 * @param lastViewedMs getLastViewed の戻り値
 * @returns 未読なら true。lastViewedMs が null の場合は false (初訪問は
 *          全て既読扱いにする — 大量のハイライトを避けるため)
 */
export function isUnread(
  createdAt: string | number,
  lastViewedMs: number | null,
): boolean {
  if (lastViewedMs === null) return false;
  const created = typeof createdAt === 'number' ? createdAt : Date.parse(createdAt);
  if (!Number.isFinite(created)) return false;
  return created > lastViewedMs;
}
