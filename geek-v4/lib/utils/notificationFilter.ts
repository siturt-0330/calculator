// ============================================================
// lib/utils/notificationFilter.ts
// ============================================================
// 通知を「アプリ内に表示すべきか」「Push を送るべきか」を判定する純関数。
// クライアント側 (NotificationList) でも、サーバー側 Edge Function でも
// 同じロジックで判定できるよう純関数として切り出している。
//
// 設計:
//   - notification.type → category mapping は notificationCategoryFor()
//   - prefs 配列の中から該当 category を引いて push / inapp の真偽を確認
//   - prefs に該当 category が無ければ default true (fail-open: 設定漏れで
//     重要通知を握りつぶさない)
//   - 未知の type は 'system' カテゴリに fallback
// ============================================================

import type { NotificationCategory, NotificationPref } from '../api/notificationPreferences';

/**
 * notification.type 文字列を 11 カテゴリの 1 つに正規化する。
 *
 * 既存 notifications.type が来た場合 ('like' / 'comment' / 'follow' /
 * 'reply' / 'event' / 'official_post') はそのまま category として扱う。
 * 新規 type (friend_request / friend_accept / mention / mod_action / system)
 * もそのまま渡って良い。未知の type は安全側に倒して 'system' に丸める。
 */
export function notificationCategoryFor(type: string): NotificationCategory {
  switch (type) {
    case 'like':
    case 'comment':
    case 'reply':
    case 'mention':
    case 'follow':
    case 'friend_request':
    case 'friend_accept':
    case 'official_post':
    case 'event':
    case 'mod_action':
    case 'system':
    case 'community_post':
      return type;
    default:
      // 未知 type は system 通知として扱う (運営からのお知らせと同等)
      return 'system';
  }
}

function lookupPref(
  prefs: readonly NotificationPref[],
  category: NotificationCategory,
): NotificationPref | undefined {
  return prefs.find((p) => p.category === category);
}

/**
 * アプリ内通知一覧に表示すべきかどうか。
 * - inapp=true → 表示
 * - inapp=false → 非表示 (一覧からも消える)
 * - prefs 未設定カテゴリ → default true (fail-open)
 */
export function shouldShowInApp(
  notification: { type: string },
  prefs: readonly NotificationPref[],
): boolean {
  const category = notificationCategoryFor(notification.type);
  const pref = lookupPref(prefs, category);
  // 未設定なら default true (settings 未保存ユーザーの体験を壊さない)
  if (!pref) return true;
  return pref.inapp;
}

/**
 * Push 通知を配信すべきかどうか。
 * - push=true → 配信
 * - push=false → 配信しない
 * - prefs 未設定カテゴリ → default true (fail-open)
 *
 * server 側 Edge Function (send-push) から呼び出す想定の純関数。
 * 同じロジックがクライアントとサーバーで動くので、UX 差分が出ない。
 */
export function shouldSendPush(
  notification: { type: string },
  prefs: readonly NotificationPref[],
): boolean {
  const category = notificationCategoryFor(notification.type);
  const pref = lookupPref(prefs, category);
  if (!pref) return true;
  return pref.push;
}
