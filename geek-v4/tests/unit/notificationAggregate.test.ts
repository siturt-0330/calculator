// ============================================================
// notificationAggregate.test.ts — 通知集約 (IG/X 流) の回帰防止
// ------------------------------------------------------------
// lib/notifications/aggregate.ts の純関数を検証する。
//   - 同じ投稿への同種反応 (like/comment/reply) は 1 グループに
//   - 異なる投稿 / 非集約 type は別行のまま
//   - グループの未読・時刻・メッセージ・順序の契約
// ============================================================

import { aggregateNotifications } from '../../lib/notifications/aggregate';
import type { Notification } from '../../types/models';

let seq = 0;
function n(over: Partial<Notification> & { type: Notification['type'] }): Notification {
  seq += 1;
  return {
    id: over.id ?? `n${seq}`,
    type: over.type,
    tag_name: over.tag_name ?? null,
    message: over.message ?? `msg-${seq}`,
    read: over.read ?? false,
    data: over.data ?? null,
    created_at: over.created_at ?? `2026-06-12T0${Math.min(9, seq)}:00:00Z`,
  } as Notification;
}

describe('aggregateNotifications', () => {
  beforeEach(() => {
    seq = 0;
  });

  it('同じ投稿への like を 1 グループに集約し件数メッセージを出す', () => {
    const list = [
      n({ type: 'like', data: { post_id: 'p1' }, message: 'Aさんがいいねしました' }),
      n({ type: 'like', data: { post_id: 'p1' }, message: 'Bさんがいいねしました' }),
      n({ type: 'like', data: { post_id: 'p1' }, message: 'Cさんがいいねしました' }),
    ];
    const groups = aggregateNotifications(list);
    expect(groups).toHaveLength(1);
    const g = groups[0]!;
    expect(g.count).toBe(3);
    expect(g.message).toContain('3 件');
    expect(g.postId).toBe('p1');
    // 代表 = 最新 (リスト先頭)
    expect(g.latest.message).toBe('Aさんがいいねしました');
  });

  it('1 件だけのグループは元のメッセージ (ニックネーム入り) を保つ', () => {
    const list = [n({ type: 'like', data: { post_id: 'p1' }, message: 'Aさんがいいねしました' })];
    const groups = aggregateNotifications(list);
    expect(groups[0]!.message).toBe('Aさんがいいねしました');
  });

  it('異なる投稿への like は別グループ', () => {
    const list = [
      n({ type: 'like', data: { post_id: 'p1' } }),
      n({ type: 'like', data: { post_id: 'p2' } }),
    ];
    expect(aggregateNotifications(list)).toHaveLength(2);
  });

  it('like と comment は同じ投稿でも別グループ', () => {
    const list = [
      n({ type: 'like', data: { post_id: 'p1' } }),
      n({ type: 'comment', data: { post_id: 'p1' } }),
    ];
    const groups = aggregateNotifications(list);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.type).sort()).toEqual(['comment', 'like']);
  });

  it('post_id の無い like / 非集約 type (official_post 等) は単独行のまま', () => {
    const list = [
      n({ type: 'like', data: null }),
      n({ type: 'official_post', data: { post_id: 'p1' } }),
      n({ type: 'official_post', data: { post_id: 'p1' } }),
      n({ type: 'system' }),
    ];
    // official_post は同じ post_id でも集約しない
    expect(aggregateNotifications(list)).toHaveLength(4);
  });

  it('未読が 1 件でもあればグループは未読・unreadIds はその id のみ', () => {
    const list = [
      n({ id: 'a', type: 'like', data: { post_id: 'p1' }, read: true }),
      n({ id: 'b', type: 'like', data: { post_id: 'p1' }, read: false }),
      n({ id: 'c', type: 'like', data: { post_id: 'p1' }, read: true }),
    ];
    const g = aggregateNotifications(list)[0]!;
    expect(g.unread).toBe(true);
    expect(g.unreadIds).toEqual(['b']);
  });

  it('全件既読ならグループも既読', () => {
    const list = [
      n({ type: 'like', data: { post_id: 'p1' }, read: true }),
      n({ type: 'like', data: { post_id: 'p1' }, read: true }),
    ];
    const g = aggregateNotifications(list)[0]!;
    expect(g.unread).toBe(false);
    expect(g.unreadIds).toEqual([]);
  });

  it('グループの時刻は最新通知の created_at (リストは新しい順前提)', () => {
    const list = [
      n({ type: 'like', data: { post_id: 'p1' }, created_at: '2026-06-12T10:00:00Z' }),
      n({ type: 'like', data: { post_id: 'p1' }, created_at: '2026-06-10T10:00:00Z' }),
    ];
    expect(aggregateNotifications(list)[0]!.createdAt).toBe('2026-06-12T10:00:00Z');
  });

  it('行順序は「グループ内最新通知」の出現順 (新しい順) を保つ', () => {
    const list = [
      n({ id: 'newest', type: 'comment', data: { post_id: 'p2' } }),
      n({ id: 'mid', type: 'like', data: { post_id: 'p1' } }),
      n({ id: 'old', type: 'like', data: { post_id: 'p1' } }),
      n({ id: 'oldest', type: 'system' }),
    ];
    const ids = aggregateNotifications(list).map((g) => g.id);
    expect(ids).toEqual(['comment:p2', 'like:p1', 'single:oldest']);
  });

  it('reply の集約メッセージは「返信」表現', () => {
    const list = [
      n({ type: 'reply', data: { post_id: 'p1' } }),
      n({ type: 'reply', data: { post_id: 'p1' } }),
    ];
    expect(aggregateNotifications(list)[0]!.message).toContain('返信');
  });

  it('空リストは空配列', () => {
    expect(aggregateNotifications([])).toEqual([]);
  });
});
