// ============================================================
// modActionReasons unit tests
// ============================================================
// 純関数 / 純データなので jest で素直にテスト可能。
// getReasonLabel と preset list の整合性 / 型を検証する。
// ============================================================

import {
  MOD_DELETE_REASONS,
  MOD_KICK_REASONS,
  MOD_BAN_REASONS,
  getReasonLabel,
  getReasonsFor,
} from '../../lib/utils/modActionReasons';

describe('modActionReasons preset lists', () => {
  it('MOD_DELETE_REASONS contains spec-defined keys', () => {
    const keys = MOD_DELETE_REASONS.map((r) => r.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'abuse',
        'spam',
        'harassment',
        'rule_violation',
        'inappropriate',
        'other',
      ]),
    );
  });

  it('MOD_KICK_REASONS contains spec-defined keys', () => {
    const keys = MOD_KICK_REASONS.map((r) => r.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'repeated_violation',
        'community_inappropriate',
        'harassment',
        'other',
      ]),
    );
  });

  it('MOD_BAN_REASONS contains spec-defined keys', () => {
    const keys = MOD_BAN_REASONS.map((r) => r.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'severe_violation',
        'repeated_abuse',
        'spam_account',
        'doxxing',
        'other',
      ]),
    );
  });

  it('every preset entry has key/label/icon all non-empty', () => {
    const all = [...MOD_DELETE_REASONS, ...MOD_KICK_REASONS, ...MOD_BAN_REASONS];
    for (const r of all) {
      expect(typeof r.key).toBe('string');
      expect(typeof r.label).toBe('string');
      expect(typeof r.icon).toBe('string');
      expect(r.key.length).toBeGreaterThan(0);
      expect(r.label.length).toBeGreaterThan(0);
      expect(r.icon.length).toBeGreaterThan(0);
    }
  });

  it('every preset list ends with "other" so UI can render free-text last', () => {
    expect(MOD_DELETE_REASONS[MOD_DELETE_REASONS.length - 1]?.key).toBe('other');
    expect(MOD_KICK_REASONS[MOD_KICK_REASONS.length - 1]?.key).toBe('other');
    expect(MOD_BAN_REASONS[MOD_BAN_REASONS.length - 1]?.key).toBe('other');
  });
});

describe('getReasonLabel', () => {
  it('returns "理由なし" for null / undefined / empty / whitespace', () => {
    expect(getReasonLabel(null)).toBe('理由なし');
    expect(getReasonLabel(undefined)).toBe('理由なし');
    expect(getReasonLabel('')).toBe('理由なし');
    expect(getReasonLabel('   ')).toBe('理由なし');
  });

  it('returns Japanese label for known delete key', () => {
    expect(getReasonLabel('abuse')).toBe('暴言');
    expect(getReasonLabel('spam')).toBe('スパム');
    expect(getReasonLabel('rule_violation')).toBe('ルール違反');
  });

  it('returns Japanese label for known kick / ban key', () => {
    expect(getReasonLabel('repeated_violation')).toBe('繰り返しの違反');
    expect(getReasonLabel('spam_account')).toBe('スパムアカウント');
    expect(getReasonLabel('doxxing')).toBe('個人情報の晒し');
  });

  it('returns "その他" for the "other" key (resolves to delete reasons first)', () => {
    expect(getReasonLabel('other')).toBe('その他');
  });

  it('passes through unknown / free-text reasons unchanged', () => {
    expect(getReasonLabel('カスタム理由テスト')).toBe('カスタム理由テスト');
    expect(getReasonLabel('not_a_known_key')).toBe('not_a_known_key');
  });
});

describe('getReasonsFor', () => {
  it('returns MOD_DELETE_REASONS for "delete"', () => {
    expect(getReasonsFor('delete')).toBe(MOD_DELETE_REASONS);
  });

  it('returns MOD_KICK_REASONS for "kick"', () => {
    expect(getReasonsFor('kick')).toBe(MOD_KICK_REASONS);
  });

  it('returns MOD_BAN_REASONS for "ban"', () => {
    expect(getReasonsFor('ban')).toBe(MOD_BAN_REASONS);
  });
});
