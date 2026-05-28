// ============================================================
// lib/utils/notificationFilter.test.ts
// ============================================================
// 通知 preference 細分化 (migration 0070) の filter 純関数を検証。
//
// テスト観点:
//   1. notificationCategoryFor: 全 11 カテゴリの mapping + 未知 type fallback
//   2. shouldShowInApp: inapp=true/false の制御 + 未設定時 default true
//   3. shouldSendPush: push=true/false の制御 + 未設定時 default true
//   4. 両軸独立: push off / inapp on のような片寄せが効くこと
// ============================================================

import {
  shouldShowInApp,
  shouldSendPush,
  notificationCategoryFor,
} from '../../lib/utils/notificationFilter';
import type { NotificationPref } from '../../lib/api/notificationPreferences';

// ============================================================
// helper: pref を 1 行だけ持つ配列を作る
// ============================================================
function prefsOf(
  category: NotificationPref['category'],
  push: boolean,
  inapp: boolean,
): NotificationPref[] {
  return [{ category, push, inapp }];
}

describe('notificationCategoryFor', () => {
  it('既知 type は同名 category に変換される (like / comment / reply / mention / follow)', () => {
    expect(notificationCategoryFor('like')).toBe('like');
    expect(notificationCategoryFor('comment')).toBe('comment');
    expect(notificationCategoryFor('reply')).toBe('reply');
    expect(notificationCategoryFor('mention')).toBe('mention');
    expect(notificationCategoryFor('follow')).toBe('follow');
  });

  it('友達系・公式・イベント・mod 系・system も同名 category に変換される', () => {
    expect(notificationCategoryFor('friend_request')).toBe('friend_request');
    expect(notificationCategoryFor('friend_accept')).toBe('friend_accept');
    expect(notificationCategoryFor('official_post')).toBe('official_post');
    expect(notificationCategoryFor('event')).toBe('event');
    expect(notificationCategoryFor('mod_action')).toBe('mod_action');
    expect(notificationCategoryFor('system')).toBe('system');
  });

  it('未知の type は "system" にフォールバック', () => {
    expect(notificationCategoryFor('unknown_type')).toBe('system');
    expect(notificationCategoryFor('')).toBe('system');
    expect(notificationCategoryFor('LIKE')).toBe('system'); // 大文字違いも未知扱い
  });
});

describe('shouldShowInApp', () => {
  it('inapp=true なら表示する', () => {
    const prefs = prefsOf('like', true, true);
    expect(shouldShowInApp({ type: 'like' }, prefs)).toBe(true);
  });

  it('inapp=false なら表示しない (push の値とは独立)', () => {
    const prefs = prefsOf('like', true, false);
    expect(shouldShowInApp({ type: 'like' }, prefs)).toBe(false);
  });

  it('該当 category が prefs に無いときは default true (fail-open)', () => {
    const prefs: NotificationPref[] = [];
    expect(shouldShowInApp({ type: 'comment' }, prefs)).toBe(true);
  });

  it('未知 type は system カテゴリで判定される — system off なら非表示', () => {
    const prefs = prefsOf('system', true, false);
    expect(shouldShowInApp({ type: 'random_new_type' }, prefs)).toBe(false);
  });
});

describe('shouldSendPush', () => {
  it('push=true なら配信する', () => {
    const prefs = prefsOf('mention', true, true);
    expect(shouldSendPush({ type: 'mention' }, prefs)).toBe(true);
  });

  it('push=false なら配信しない (inapp の値とは独立)', () => {
    const prefs = prefsOf('mention', false, true);
    expect(shouldSendPush({ type: 'mention' }, prefs)).toBe(false);
  });

  it('該当 category が prefs に無いときは default true', () => {
    expect(shouldSendPush({ type: 'event' }, [])).toBe(true);
  });

  it('push off / inapp on の片寄せ — Push は出ないが一覧には残る', () => {
    const prefs = prefsOf('like', false, true);
    expect(shouldSendPush({ type: 'like' }, prefs)).toBe(false);
    expect(shouldShowInApp({ type: 'like' }, prefs)).toBe(true);
  });

  it('push on / inapp off の片寄せ — Push 出るが一覧には残らない', () => {
    const prefs = prefsOf('comment', true, false);
    expect(shouldSendPush({ type: 'comment' }, prefs)).toBe(true);
    expect(shouldShowInApp({ type: 'comment' }, prefs)).toBe(false);
  });
});

describe('複数カテゴリ混在の prefs (実運用シナリオ)', () => {
  const prefs: NotificationPref[] = [
    { category: 'like', push: false, inapp: true },
    { category: 'comment', push: true, inapp: true },
    { category: 'mod_action', push: true, inapp: false },
  ];

  it('like は inapp だけ表示・Push しない', () => {
    expect(shouldShowInApp({ type: 'like' }, prefs)).toBe(true);
    expect(shouldSendPush({ type: 'like' }, prefs)).toBe(false);
  });

  it('comment は Push も inapp も両方', () => {
    expect(shouldShowInApp({ type: 'comment' }, prefs)).toBe(true);
    expect(shouldSendPush({ type: 'comment' }, prefs)).toBe(true);
  });

  it('mod_action は Push だけ — 一覧に出さない', () => {
    expect(shouldShowInApp({ type: 'mod_action' }, prefs)).toBe(false);
    expect(shouldSendPush({ type: 'mod_action' }, prefs)).toBe(true);
  });

  it('prefs に無い follow は default true (全許可)', () => {
    expect(shouldShowInApp({ type: 'follow' }, prefs)).toBe(true);
    expect(shouldSendPush({ type: 'follow' }, prefs)).toBe(true);
  });
});
