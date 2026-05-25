// ============================================================
// lib/community/genreOverride.ts のロジック検証
// ============================================================
// effectiveGenre のマージルール:
//   - server が legacy / undefined / null → local override を優先
//   - server が oshi / creative / etc → server を尊重
//
// lib/storage.ts は react-native chain を引き込むので、jest 内では
// in-memory mock に差し替えて純関数として検証する。
// ============================================================

// lib/storage を in-memory mock に置き換え (react-native を引き込まない)
jest.mock('../../lib/storage', () => {
  const mem = new Map<string, unknown>();
  return {
    getJson: <T>(key: string): T | undefined => mem.get(key) as T | undefined,
    setJson: <T>(key: string, val: T): void => {
      mem.set(key, val);
    },
    // 念のため他 export も noop で
    getString: () => undefined,
    setString: () => {},
    getBool: () => undefined,
    setBool: () => {},
    getNumber: () => undefined,
    setNumber: () => {},
    remove: (key: string) => { mem.delete(key); },
    contains: (key: string) => mem.has(key),
    storage: {},
  };
});

import {
  effectiveGenre,
  setGenreOverride,
  getGenreOverride,
  removeGenreOverride,
} from '../../lib/community/genreOverride';

const ID_A = '11111111-2222-3333-4444-555555555555';
const ID_B = '11111111-2222-3333-4444-666666666666';

describe('effectiveGenre — server / override の merge', () => {
  beforeEach(() => {
    removeGenreOverride(ID_A);
    removeGenreOverride(ID_B);
  });

  it('server が意味のある値ならそのまま返る (override 無視)', () => {
    setGenreOverride(ID_A, 'experience');
    expect(effectiveGenre(ID_A, 'oshi')).toBe('oshi');
    expect(effectiveGenre(ID_A, 'creative')).toBe('creative');
  });

  it('server が legacy なら override を優先', () => {
    setGenreOverride(ID_A, 'oshi');
    expect(effectiveGenre(ID_A, 'legacy')).toBe('oshi');
  });

  it('server が undefined なら override を優先', () => {
    setGenreOverride(ID_A, 'experience');
    expect(effectiveGenre(ID_A, undefined)).toBe('experience');
  });

  it('server が null なら override を優先', () => {
    setGenreOverride(ID_A, 'creative');
    expect(effectiveGenre(ID_A, null)).toBe('creative');
  });

  it('server も override も無ければ legacy にフォールバック', () => {
    expect(effectiveGenre(ID_A, undefined)).toBe('legacy');
    expect(effectiveGenre(ID_A, null)).toBe('legacy');
  });

  it('別の id で override を引かない (isolation)', () => {
    setGenreOverride(ID_A, 'oshi');
    expect(effectiveGenre(ID_B, undefined)).toBe('legacy');
  });
});

describe('setGenreOverride / getGenreOverride / removeGenreOverride', () => {
  beforeEach(() => {
    removeGenreOverride(ID_A);
  });

  it('set → get で同じ値が返る', () => {
    setGenreOverride(ID_A, 'oshi');
    expect(getGenreOverride(ID_A)).toBe('oshi');
  });

  it('set で上書きされる', () => {
    setGenreOverride(ID_A, 'oshi');
    setGenreOverride(ID_A, 'experience');
    expect(getGenreOverride(ID_A)).toBe('experience');
  });

  it('remove で undefined に戻る', () => {
    setGenreOverride(ID_A, 'creative');
    removeGenreOverride(ID_A);
    expect(getGenreOverride(ID_A)).toBeUndefined();
  });

  it('未設定の id は undefined', () => {
    expect(getGenreOverride(ID_B)).toBeUndefined();
  });

  it('空 communityId は何もしない (defensive)', () => {
    setGenreOverride('', 'oshi');
    expect(getGenreOverride('')).toBeUndefined();
  });

  it('不正な genre は受け付けない', () => {
    // @ts-expect-error テストの都合で型外を渡す
    setGenreOverride(ID_A, 'invalid_genre');
    expect(getGenreOverride(ID_A)).toBeUndefined();
  });
});
