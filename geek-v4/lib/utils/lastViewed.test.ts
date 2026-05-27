// ============================================================
// lastViewed helper の unit test
// ------------------------------------------------------------
// lib/storage.ts は内部で react-native を import するため、
// Jest preset 無しの環境では transform に失敗する。
// → ../storage を in-memory モックに差し替えて helper のロジックだけ
//    テストする (storage 経由の永続化は storage 自体の責務)。
// ============================================================

jest.mock('../storage', () => {
  const memory = new Map<string, string>();
  return {
    getString: (k: string) => memory.get(k),
    setString: (k: string, v: string) => {
      memory.set(k, v);
    },
    remove: (k: string) => {
      memory.delete(k);
    },
    __reset: () => memory.clear(),
  };
});

import { getLastViewed, setLastViewed, clearLastViewed, isUnread } from './lastViewed';
import * as storage from '../storage';

// jest.mock で差し替えた storage モジュールに付与した __reset を呼ぶための型
type MockedStorage = typeof storage & { __reset: () => void };

beforeEach(() => {
  (storage as MockedStorage).__reset();
});

describe('getLastViewed / setLastViewed', () => {
  it('returns null when nothing saved yet', () => {
    expect(getLastViewed('post', 'abc')).toBeNull();
  });

  it('round-trips a value (Date.now() at save)', () => {
    const before = Date.now();
    setLastViewed('post', 'p1');
    const after = Date.now();
    const v = getLastViewed('post', 'p1');
    expect(v).not.toBeNull();
    if (v !== null) {
      expect(v).toBeGreaterThanOrEqual(before);
      expect(v).toBeLessThanOrEqual(after);
    }
  });

  it('keeps scopes independent (post vs thread)', () => {
    setLastViewed('post', 'same-id');
    expect(getLastViewed('post', 'same-id')).not.toBeNull();
    expect(getLastViewed('thread', 'same-id')).toBeNull();
    expect(getLastViewed('community', 'same-id')).toBeNull();
  });

  it('keeps ids independent within same scope', () => {
    setLastViewed('post', 'a');
    expect(getLastViewed('post', 'a')).not.toBeNull();
    expect(getLastViewed('post', 'b')).toBeNull();
  });

  it('empty id is a no-op for both get and set', () => {
    setLastViewed('post', '');
    expect(getLastViewed('post', '')).toBeNull();
  });

  it('clearLastViewed deletes the saved timestamp', () => {
    setLastViewed('post', 'x');
    expect(getLastViewed('post', 'x')).not.toBeNull();
    clearLastViewed('post', 'x');
    expect(getLastViewed('post', 'x')).toBeNull();
  });
});

describe('isUnread', () => {
  it('returns false when lastViewedMs is null (first visit)', () => {
    expect(isUnread(new Date().toISOString(), null)).toBe(false);
  });

  it('returns true when created_at > lastViewedMs', () => {
    const last = Date.parse('2026-05-27T10:00:00Z');
    const created = '2026-05-27T11:00:00Z';
    expect(isUnread(created, last)).toBe(true);
  });

  it('returns false when created_at <= lastViewedMs', () => {
    const last = Date.parse('2026-05-27T12:00:00Z');
    const created = '2026-05-27T10:00:00Z';
    expect(isUnread(created, last)).toBe(false);
  });

  it('accepts epoch ms for createdAt', () => {
    const last = 1_000_000;
    expect(isUnread(2_000_000, last)).toBe(true);
    expect(isUnread(500_000, last)).toBe(false);
  });

  it('returns false for invalid createdAt strings', () => {
    expect(isUnread('not-a-date', Date.now() - 1000)).toBe(false);
  });
});
