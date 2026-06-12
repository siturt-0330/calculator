// ============================================================
// lib/notifications/aggregate.ts — 通知の集約 (Instagram / X 流)
// ------------------------------------------------------------
// 「○○ がいいねしました」が 1 件ずつ並ぶと人気投稿で通知が洪水になる。
// IG/X と同じく「同じ投稿への同種の反応」を 1 行に集約する:
//   - like / comment / reply で data.post_id が同じものを 1 グループに
//   - グループの時刻は最新の通知、未読はグループ内に 1 件でもあれば未読
//   - タップ時はグループ内の未読を一括既読化 (unreadIds)
// 純関数 — unit test: tests/unit/notificationAggregate.test.ts
// ============================================================

import type { Notification } from '../../types/models';

// 集約対象 type — 同じ投稿への反応が複数届くもの。
// official_post / join_request / mod_action / system 等は 1 件 = 1 行のまま。
const AGGREGATABLE: ReadonlySet<string> = new Set(['like', 'comment', 'reply']);

export type NotificationGroup = {
  /** 行 key。グループは `type:post_id`、単独は通知 id */
  id: string;
  type: Notification['type'];
  /** 集約キーに使った post_id (単独行は data に post_id があってもここは持つ) */
  postId: string | null;
  /** 構成通知 (新しい順) */
  items: Notification[];
  /** 表示メッセージ — 1 件なら元の message (ニックネーム入り)、複数なら件数表記 */
  message: string;
  /** グループの代表時刻 = 最新通知の created_at */
  createdAt: string;
  /** 未読を 1 件でも含むか */
  unread: boolean;
  /** 未読の通知 id (タップ時に一括既読化する) */
  unreadIds: string[];
  count: number;
  tagName: string | null;
  /** 遷移先の解決に使う代表通知 (最新) */
  latest: Notification;
};

function postIdOf(n: Notification): string | null {
  const d = n.data as { post_id?: unknown } | null | undefined;
  return d && typeof d.post_id === 'string' && d.post_id.length > 0 ? d.post_id : null;
}

// 集約時のメッセージ。匿名 SNS なので「誰が」は出さず件数で表現する
// (1 件のときは DB トリガ由来の元メッセージ = ニックネーム入りをそのまま使う)。
function aggregatedMessage(
  type: Notification['type'],
  count: number,
  latest: Notification,
): string {
  if (count === 1) return latest.message;
  switch (type) {
    case 'like':
      return `あなたの投稿に いいね・リアクションが ${count} 件届きました`;
    case 'comment':
      return `あなたの投稿に ${count} 件のコメントが届きました`;
    case 'reply':
      return `あなたのコメントに ${count} 件の返信が届きました`;
    default:
      return latest.message;
  }
}

/**
 * 通知リスト (新しい順) を表示用グループに集約する。
 * グループの順序は「グループ内最新通知」の出現順 (= 新しい順) を保つ。
 */
export function aggregateNotifications(list: Notification[]): NotificationGroup[] {
  const buckets = new Map<string, Notification[]>();
  const order: string[] = [];
  for (const n of list) {
    const pid = postIdOf(n);
    const key = AGGREGATABLE.has(n.type) && pid ? `${n.type}:${pid}` : `single:${n.id}`;
    const arr = buckets.get(key);
    if (arr) {
      arr.push(n);
    } else {
      buckets.set(key, [n]);
      order.push(key);
    }
  }
  const out: NotificationGroup[] = [];
  for (const key of order) {
    const items = buckets.get(key);
    const latest = items?.[0];
    if (!items || !latest) continue; // 実際には起きない (Map 構築と同順)
    const unreadIds = items.filter((n) => !n.read).map((n) => n.id);
    out.push({
      id: key,
      type: latest.type,
      postId: postIdOf(latest),
      items,
      message: aggregatedMessage(latest.type, items.length, latest),
      createdAt: latest.created_at,
      unread: unreadIds.length > 0,
      unreadIds,
      count: items.length,
      tagName: latest.tag_name,
      latest,
    });
  }
  return out;
}
