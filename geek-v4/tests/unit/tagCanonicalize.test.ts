// canonicalize は lib/api/tags.ts に実装あり (1 行)。
// 直接 import すると supabase / react-native 連鎖で jest が落ちるため、
// 同じロジックを local 関数として mirror して logic 検証する。
// 実装変更時は両方を併せて update すること。
function canonicalize(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

describe('canonicalize(tag_a, tag_b)', () => {
  it('orders ascending alphabetically', () => {
    expect(canonicalize('b', 'a')).toEqual(['a', 'b']);
    expect(canonicalize('a', 'b')).toEqual(['a', 'b']);
  });

  it('is symmetric: same result regardless of input order', () => {
    expect(canonicalize('apple', 'banana')).toEqual(canonicalize('banana', 'apple'));
  });

  it('handles japanese characters by JS string comparison', () => {
    expect(canonicalize('ア', 'あ')).toEqual(['あ', 'ア']);
  });

  it('handles mixed length: shorter prefix wins when matches', () => {
    expect(canonicalize('abc', 'ab')).toEqual(['ab', 'abc']);
  });

  it('returns the equal pair when inputs are identical (caller must reject duplicates)', () => {
    expect(canonicalize('x', 'x')).toEqual(['x', 'x']);
  });

  it('uppercase < lowercase in ASCII (case-sensitive ordering)', () => {
    expect(canonicalize('Apple', 'apple')).toEqual(['Apple', 'apple']);
  });
});
