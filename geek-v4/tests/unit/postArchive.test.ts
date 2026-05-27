// ============================================================
// postArchive helper の unit test (Reddit ガイド #15 / 2.10 / 3.7)
// ------------------------------------------------------------
// 仕様: lib/utils/postArchive.ts と DB 側
//        (supabase/migrations/0066_post_archive.sql) が
//        同じ境界 (= 90 日丁度では未アーカイブ, > 90 日でアーカイブ) を
//        持つことを境界値で確認する.
//
// 戦略: Date.now() を fixed-time に固定して created_at の差で挙動を見る.
//        beforeEach / afterEach で systemTime をきっちり戻す.
// ============================================================

import {
  ARCHIVE_DAYS,
  isPostArchived,
  daysUntilArchive,
  archivedAtDate,
} from '../../lib/utils/postArchive';

const DAY = 86_400_000;
// 固定 "現在時刻". 2026-05-27T00:00:00Z = 1748304000000.
const NOW_ISO = '2026-05-27T00:00:00.000Z';
const NOW = Date.parse(NOW_ISO);

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(NOW));
});

afterEach(() => {
  jest.useRealTimers();
});

describe('ARCHIVE_DAYS export', () => {
  it('は 90 日に固定 (DB 側 interval と一致)', () => {
    expect(ARCHIVE_DAYS).toBe(90);
  });
});

describe('isPostArchived — 境界', () => {
  it('丁度 90 日経過 (= 境界) は **未** アーカイブ (>, 厳密大なり)', () => {
    const created = new Date(NOW - 90 * DAY).toISOString();
    expect(isPostArchived(created)).toBe(false);
  });

  it('89 日経過は未アーカイブ', () => {
    const created = new Date(NOW - 89 * DAY).toISOString();
    expect(isPostArchived(created)).toBe(false);
  });

  it('91 日経過はアーカイブ', () => {
    const created = new Date(NOW - 91 * DAY).toISOString();
    expect(isPostArchived(created)).toBe(true);
  });

  it('90 日 + 1ms 経過はアーカイブ (= 厳密大なりの境界)', () => {
    const created = new Date(NOW - (90 * DAY + 1)).toISOString();
    expect(isPostArchived(created)).toBe(true);
  });

  it('未来の created_at (= 0 経過) は未アーカイブ', () => {
    const created = new Date(NOW + DAY).toISOString();
    expect(isPostArchived(created)).toBe(false);
  });

  it('Date instance も受け取れる', () => {
    expect(isPostArchived(new Date(NOW - 100 * DAY))).toBe(true);
    expect(isPostArchived(new Date(NOW - 1 * DAY))).toBe(false);
  });

  it('epoch ms (number) も受け取れる', () => {
    expect(isPostArchived(NOW - 100 * DAY)).toBe(true);
    expect(isPostArchived(NOW - 1 * DAY)).toBe(false);
  });

  it('invalid input (不正文字列) は false', () => {
    expect(isPostArchived('not-a-date')).toBe(false);
  });

  it('invalid input (NaN) は false', () => {
    expect(isPostArchived(NaN)).toBe(false);
  });
});

describe('daysUntilArchive', () => {
  it('丁度 90 日経過 → 0 日 (= 境界では 0)', () => {
    // 残り 0ms → 0 を返す (<= 0 のガード).
    const created = new Date(NOW - 90 * DAY).toISOString();
    expect(daysUntilArchive(created)).toBe(0);
  });

  it('89 日経過 → 残り 1 日 (Math.ceil)', () => {
    const created = new Date(NOW - 89 * DAY).toISOString();
    expect(daysUntilArchive(created)).toBe(1);
  });

  it('30 日経過 → 残り 60 日', () => {
    const created = new Date(NOW - 30 * DAY).toISOString();
    expect(daysUntilArchive(created)).toBe(60);
  });

  it('丁度 created_at = now → 残り 90 日', () => {
    expect(daysUntilArchive(NOW_ISO)).toBe(ARCHIVE_DAYS);
  });

  it('アーカイブ済 (91 日経過) → 0', () => {
    const created = new Date(NOW - 91 * DAY).toISOString();
    expect(daysUntilArchive(created)).toBe(0);
  });

  it('end-of-day (10 時間残り) は Math.ceil で 1 を返す', () => {
    // remainingMs = 10h = 36_000_000 → ceil(0.416...) = 1
    const created = new Date(NOW - (90 * DAY - 10 * 3600_000)).toISOString();
    expect(daysUntilArchive(created)).toBe(1);
  });

  it('invalid input は 0', () => {
    expect(daysUntilArchive('garbage')).toBe(0);
    expect(daysUntilArchive(NaN)).toBe(0);
  });
});

describe('archivedAtDate', () => {
  it('created_at + 90 day を Date で返す', () => {
    const created = new Date(NOW - 10 * DAY); // 10 日前 → アーカイブまであと 80 日
    const expected = new Date(created.getTime() + ARCHIVE_DAYS * DAY);
    expect(archivedAtDate(created).getTime()).toBe(expected.getTime());
  });

  it('文字列入力でも計算が同じ', () => {
    const created = new Date(NOW - 10 * DAY);
    const fromString = archivedAtDate(created.toISOString());
    const fromDate = archivedAtDate(created);
    expect(fromString.getTime()).toBe(fromDate.getTime());
  });

  it('invalid input は Invalid Date を返す', () => {
    const d = archivedAtDate('not-a-date');
    expect(Number.isNaN(d.getTime())).toBe(true);
  });

  it('epoch ms 入力も受け取れる', () => {
    const d = archivedAtDate(NOW);
    expect(d.getTime()).toBe(NOW + ARCHIVE_DAYS * DAY);
  });
});

describe('境界一貫性 — 各 helper の結果が整合する', () => {
  it('isPostArchived=false なら daysUntilArchive>0 で archivedAtDate が未来', () => {
    const created = new Date(NOW - 50 * DAY).toISOString();
    expect(isPostArchived(created)).toBe(false);
    expect(daysUntilArchive(created)).toBeGreaterThan(0);
    expect(archivedAtDate(created).getTime()).toBeGreaterThan(NOW);
  });

  it('isPostArchived=true なら daysUntilArchive=0 で archivedAtDate が過去', () => {
    const created = new Date(NOW - 120 * DAY).toISOString();
    expect(isPostArchived(created)).toBe(true);
    expect(daysUntilArchive(created)).toBe(0);
    expect(archivedAtDate(created).getTime()).toBeLessThan(NOW);
  });
});
