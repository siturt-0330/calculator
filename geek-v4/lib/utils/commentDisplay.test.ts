import { getDisplayCommentLikes } from './commentDisplay';

describe('getDisplayCommentLikes', () => {
  // ベースとなる "now" (テスト中の現在時刻)
  const NOW = new Date('2026-05-27T12:00:00Z').getTime();

  it("returns '-' when age < 5 min (likes > 0)", () => {
    const createdAt = new Date(NOW - 2 * 60 * 1000).toISOString(); // 2 分前
    expect(getDisplayCommentLikes(createdAt, 5, NOW)).toBe('-');
  });

  it("returns '-' when age < 5 min (likes = 0)", () => {
    const createdAt = new Date(NOW - 60 * 1000).toISOString(); // 1 分前
    expect(getDisplayCommentLikes(createdAt, 0, NOW)).toBe('-');
  });

  it("returns '数件' when 5 min <= age < 30 min and likes >= 1", () => {
    const createdAt = new Date(NOW - 10 * 60 * 1000).toISOString(); // 10 分前
    expect(getDisplayCommentLikes(createdAt, 1, NOW)).toBe('数件');
    expect(getDisplayCommentLikes(createdAt, 7, NOW)).toBe('数件');
  });

  it("returns '-' when 5 min <= age < 30 min but likes = 0", () => {
    const createdAt = new Date(NOW - 20 * 60 * 1000).toISOString(); // 20 分前
    expect(getDisplayCommentLikes(createdAt, 0, NOW)).toBe('-');
  });

  it('returns numeric string when age >= 30 min', () => {
    const createdAt = new Date(NOW - 60 * 60 * 1000).toISOString(); // 1 時間前
    expect(getDisplayCommentLikes(createdAt, 42, NOW)).toBe('42');
    expect(getDisplayCommentLikes(createdAt, 0, NOW)).toBe('0');
  });

  it('boundary at exactly 5 min uses 数件 form (>= 5 min)', () => {
    const createdAt = new Date(NOW - 5 * 60 * 1000).toISOString();
    expect(getDisplayCommentLikes(createdAt, 3, NOW)).toBe('数件');
  });

  it('boundary at exactly 30 min uses numeric form', () => {
    const createdAt = new Date(NOW - 30 * 60 * 1000).toISOString();
    expect(getDisplayCommentLikes(createdAt, 10, NOW)).toBe('10');
  });

  it('handles invalid createdAt by returning numeric likes', () => {
    expect(getDisplayCommentLikes('not-a-date', 7, NOW)).toBe('7');
    expect(getDisplayCommentLikes(null, 3, NOW)).toBe('3');
    expect(getDisplayCommentLikes(undefined, undefined, NOW)).toBe('0');
  });

  it('handles future createdAt (clock skew) as numeric', () => {
    const createdAt = new Date(NOW + 60 * 1000).toISOString(); // 1 分先
    expect(getDisplayCommentLikes(createdAt, 4, NOW)).toBe('4');
  });
});
