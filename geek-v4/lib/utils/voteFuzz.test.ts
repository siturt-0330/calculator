// ============================================================
// voteFuzz — 決定性 / レンジ / 少額時 unmodified の test
// ============================================================
// @jest/globals を明示 import することで type-check (npm run type-check)
// で `describe / it / expect` の名前未解決エラーを出さない。
// 既存の tests/unit/*.test.ts は tsconfig exclude されているので
// ambient global の jest 型に頼ってよいが、 lib/utils/ に置く本 file は
// tsconfig include 配下なので import 経由で型を取る。
// ============================================================

import { describe, it, expect } from '@jest/globals';
import { fnv1a32, getVoteFuzz, getDisplayLikes } from './voteFuzz';

describe('voteFuzz', () => {
  describe('determinism', () => {
    it('returns identical fuzz for identical post_id (deterministic)', () => {
      const a = getVoteFuzz('post-abc', 100);
      const b = getVoteFuzz('post-abc', 100);
      expect(a).toBe(b);
    });

    it('returns identical display for identical post_id (deterministic)', () => {
      const a = getDisplayLikes('post-xyz', 50);
      const b = getDisplayLikes('post-xyz', 50);
      expect(a).toBe(b);
    });

    it('produces different fuzz for different post_ids (high prob)', () => {
      // 200 件の id をハッシュして 11 種類のうち少なくとも 5 種類は出るはず
      // (uniform に近ければ ~18 件/種類, 5 種類未満は天文学的低確率)
      const set = new Set<number>();
      for (let i = 0; i < 200; i++) {
        set.add(getVoteFuzz(`post-${i}`, 100));
      }
      expect(set.size).toBeGreaterThanOrEqual(5);
    });
  });

  describe('range bounds', () => {
    it('fuzz is always within [-5, +5] when likes > 10', () => {
      for (let i = 0; i < 500; i++) {
        const f = getVoteFuzz(`post-${i}`, 100);
        expect(f).toBeGreaterThanOrEqual(-5);
        expect(f).toBeLessThanOrEqual(5);
      }
    });

    it('fuzz is always within [-1, +1] when likes in 3..10', () => {
      for (let i = 0; i < 500; i++) {
        const f = getVoteFuzz(`post-${i}`, 7);
        expect(f).toBeGreaterThanOrEqual(-1);
        expect(f).toBeLessThanOrEqual(1);
      }
    });

    it('display never goes negative even with hostile noise', () => {
      // 0..1000 件の post_id について display >= 0 を保証
      for (let i = 0; i < 1000; i++) {
        const d = getDisplayLikes(`adversarial-${i}`, 0);
        expect(d).toBeGreaterThanOrEqual(0);
        const d2 = getDisplayLikes(`adversarial-${i}`, 3);
        expect(d2).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('low-count passthrough', () => {
    it('returns 0 fuzz when real_likes is 0', () => {
      expect(getVoteFuzz('post-1', 0)).toBe(0);
      expect(getDisplayLikes('post-1', 0)).toBe(0);
    });

    it('returns 0 fuzz when real_likes is 1', () => {
      expect(getVoteFuzz('post-2', 1)).toBe(0);
      expect(getDisplayLikes('post-2', 1)).toBe(1);
    });

    it('returns 0 fuzz when real_likes is 2', () => {
      expect(getVoteFuzz('post-3', 2)).toBe(0);
      expect(getDisplayLikes('post-3', 2)).toBe(2);
    });

    it('starts fuzzing from real_likes >= 3 (with ±1 cap)', () => {
      // 3..10 のレンジで少なくとも一部の post_id で fuzz != 0 が出る
      let nonZero = 0;
      for (let i = 0; i < 100; i++) {
        if (getVoteFuzz(`post-mid-${i}`, 5) !== 0) nonZero++;
      }
      expect(nonZero).toBeGreaterThan(0);
    });
  });

  describe('hash helper (fnv1a32)', () => {
    it('returns a 32-bit unsigned integer', () => {
      const h = fnv1a32('hello');
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    });

    it('is deterministic', () => {
      expect(fnv1a32('post-42')).toBe(fnv1a32('post-42'));
    });

    it('differs for empty vs non-empty input', () => {
      expect(fnv1a32('')).not.toBe(fnv1a32('a'));
    });
  });

  describe('input hardening', () => {
    it('handles NaN realLikes by treating as 0', () => {
      expect(getDisplayLikes('post-1', Number.NaN)).toBe(0);
    });

    it('handles negative realLikes by treating as 0', () => {
      expect(getDisplayLikes('post-1', -50)).toBe(0);
    });

    it('floors fractional realLikes before fuzzing', () => {
      // 2.9 → 2 → low-count branch → fuzz=0 → display=2
      expect(getDisplayLikes('post-low', 2.9)).toBe(2);
    });
  });
});
