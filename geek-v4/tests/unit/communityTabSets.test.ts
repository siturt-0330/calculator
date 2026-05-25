// ============================================================
// lib/community/tabSets.ts のテスト
// ============================================================
// migration 0044 のジャンル別タブ仕様を回帰防止する。
// ユーザー仕様 (推し系 / 作品系 / 体験系 / 議論系) からの逸脱を即検出。
// ============================================================

import { GENRE_TAB_SETS, getTabsFor } from '../../lib/community/tabSets';

describe('GENRE_TAB_SETS', () => {
  it('推し系: ホーム / 検索 / マップ / カレンダー / マイプロフ の 5 タブ', () => {
    expect(GENRE_TAB_SETS.oshi).toEqual(['feed', 'search', 'spots', 'events', 'profile']);
  });

  it('作品系: ホーム / 掲示板 / マップ の 3 タブ', () => {
    expect(GENRE_TAB_SETS.creative).toEqual(['feed', 'threads', 'spots']);
  });

  it('体験系: 6 タブ (掲示板も検索もマップもカレンダーもマイプロフも全部)', () => {
    expect(GENRE_TAB_SETS.experience).toEqual([
      'feed',
      'threads',
      'search',
      'spots',
      'events',
      'profile',
    ]);
  });

  it('議論系: ホーム / 掲示板 のみ (シンプル)', () => {
    expect(GENRE_TAB_SETS.discussion).toEqual(['feed', 'threads']);
  });

  it('legacy: 後方互換のため compose タブを保持', () => {
    expect(GENRE_TAB_SETS.legacy).toEqual(['feed', 'threads', 'spots', 'events', 'compose']);
    expect(GENRE_TAB_SETS.legacy).toContain('compose');
  });

  it('新ジャンルは compose タブを持たない (FAB に置換される設計)', () => {
    expect(GENRE_TAB_SETS.oshi).not.toContain('compose');
    expect(GENRE_TAB_SETS.creative).not.toContain('compose');
    expect(GENRE_TAB_SETS.experience).not.toContain('compose');
    expect(GENRE_TAB_SETS.discussion).not.toContain('compose');
  });
});

describe('getTabsFor — ラベル決定', () => {
  it('推し系の spots は「マップ」', () => {
    const tabs = getTabsFor('oshi', false);
    const spotTab = tabs.find((t) => t.key === 'spots');
    expect(spotTab?.label).toBe('マップ');
  });

  it('legacy の spots は「聖地」(旧ラベル維持)', () => {
    const tabs = getTabsFor('legacy', false);
    const spotTab = tabs.find((t) => t.key === 'spots');
    expect(spotTab?.label).toBe('聖地');
  });

  it('公式コミュは genre を無視して OFFICIAL_TABS を返す', () => {
    const tabs = getTabsFor('oshi', true);
    expect(tabs.map((t) => t.key)).toEqual(['feed', 'threads', 'spots', 'events', 'comments']);
    // 公式は spots を「聖地」ラベルで出す
    const spotTab = tabs.find((t) => t.key === 'spots');
    expect(spotTab?.label).toBe('聖地');
    // 公式は threads が Q&A
    const threadsTab = tabs.find((t) => t.key === 'threads');
    expect(threadsTab?.label).toBe('Q&A');
  });

  it('genre が undefined のときは legacy にフォールバック (古い fetch 結果耐性)', () => {
    const tabs = getTabsFor(undefined, false);
    expect(tabs.map((t) => t.key)).toEqual(['feed', 'threads', 'spots', 'events', 'compose']);
  });

  it('議論系の最小タブ構成 (2 タブだけ)', () => {
    const tabs = getTabsFor('discussion', false);
    expect(tabs).toHaveLength(2);
    expect(tabs[0]?.label).toBe('ホーム');
    expect(tabs[1]?.label).toBe('掲示板');
  });
});

describe('順序の保証 — タブバー UI の並び順は GENRE_TAB_SETS と一致', () => {
  it('体験系: feed → threads → search → spots → events → profile の順', () => {
    const tabs = getTabsFor('experience', false);
    expect(tabs.map((t) => t.key)).toEqual([
      'feed',
      'threads',
      'search',
      'spots',
      'events',
      'profile',
    ]);
  });
});
