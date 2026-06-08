import { shouldLandInInterestScope, MIN_INTERESTS_FOR_COLDSTART } from '../../lib/feed/coldStart';

// cold-start interest feed の純粋な決定関数のテスト。
// 「今この瞬間 closed (興味スコープ) に着地すべきか?」だけを検証する。
// one-shot (coldStartApplied sentinel) の判定は store 側の責務なのでここでは扱わない。
describe('shouldLandInInterestScope', () => {
  it('flag ON + 興味タグが閾値以上なら true (= 興味スコープへ着地)', () => {
    expect(shouldLandInInterestScope(MIN_INTERESTS_FOR_COLDSTART, true)).toBe(true);
    expect(shouldLandInInterestScope(MIN_INTERESTS_FOR_COLDSTART + 5, true)).toBe(true);
  });

  it('flag ON でも興味タグ 0 件なら false (= open のまま / safety net 維持)', () => {
    expect(shouldLandInInterestScope(0, true)).toBe(false);
  });

  it('flag OFF なら興味タグが何個でも false (= no-op / 現行どおり open)', () => {
    expect(shouldLandInInterestScope(0, false)).toBe(false);
    expect(shouldLandInInterestScope(3, false)).toBe(false);
    expect(shouldLandInInterestScope(100, false)).toBe(false);
  });

  it('閾値はちょうど MIN_INTERESTS_FOR_COLDSTART (境界) で true', () => {
    // 既定 1。閾値 - 1 (= 0) は false、閾値 (= 1) は true。
    expect(shouldLandInInterestScope(MIN_INTERESTS_FOR_COLDSTART - 1, true)).toBe(false);
    expect(shouldLandInInterestScope(MIN_INTERESTS_FOR_COLDSTART, true)).toBe(true);
  });
});
