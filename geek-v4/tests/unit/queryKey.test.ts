import { stableKeyFor } from '../../lib/utils/queryKey';

describe('stableKeyFor', () => {
  it('joins IDs raw when length <= 50', () => {
    const ids = ['a', 'b', 'c'];
    expect(stableKeyFor(ids)).toBe('a,b,c');
  });

  it('returns hash form when length > 50', () => {
    const ids = Array.from({ length: 51 }, (_, i) => `id${i.toString().padStart(4, '0')}`);
    const k = stableKeyFor(ids);
    expect(k).toMatch(/^n51:[0-9a-z]+$/);
  });

  it('produces identical key for identical input (determinism)', () => {
    const ids = Array.from({ length: 100 }, (_, i) => `post-${i}`);
    expect(stableKeyFor(ids)).toBe(stableKeyFor(ids));
  });

  it('produces different keys for different content but same length', () => {
    const a = Array.from({ length: 60 }, (_, i) => `a-${i}`);
    const b = Array.from({ length: 60 }, (_, i) => `b-${i}`);
    expect(stableKeyFor(a)).not.toBe(stableKeyFor(b));
  });

  it('produces different keys when one item changes', () => {
    const base = Array.from({ length: 60 }, (_, i) => `id-${i}`);
    const mutated = base.slice();
    mutated[30] = 'CHANGED';
    expect(stableKeyFor(base)).not.toBe(stableKeyFor(mutated));
  });

  it('handles empty array', () => {
    expect(stableKeyFor([])).toBe('');
  });

  it('boundary at exactly 50 items still joins raw', () => {
    const ids = Array.from({ length: 50 }, (_, i) => `${i}`);
    expect(stableKeyFor(ids)).toBe(ids.join(','));
    expect(stableKeyFor(ids)).not.toMatch(/^n\d+:/);
  });
});
