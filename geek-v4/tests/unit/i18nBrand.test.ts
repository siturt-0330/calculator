// ============================================================
// i18n — brand name (Geek) 保護のテスト
// ============================================================
// translateDynamic で MyMemory に渡す前後に Geek を保護する pure 関数を検証。
// 「Geek が オタク に翻訳される」事故を防ぐ。
// ============================================================

import { protectBrandNames, restoreBrandNames } from '../../lib/i18n';

describe('protectBrandNames', () => {
  it('Geek (capitalized) を placeholder に置換', () => {
    expect(protectBrandNames('Geek アプリ')).toBe('__GEEKBRAND__ アプリ');
  });

  it('日本語に挟まれた Geek も拾う (word boundary が Japanese/Latin 境界に効く)', () => {
    expect(protectBrandNames('これはGeekだよ')).toBe('これは__GEEKBRAND__だよ');
  });

  it('複数の Geek を全て置換', () => {
    expect(protectBrandNames('Geek と Geek')).toBe('__GEEKBRAND__ と __GEEKBRAND__');
  });

  it('小文字 geek は触らない (一般名詞として翻訳して OK)', () => {
    expect(protectBrandNames('he is a geek')).toBe('he is a geek');
  });

  it('Geek を含む別単語は誤爆しない (word boundary)', () => {
    expect(protectBrandNames('Geeky')).toBe('Geeky');
    expect(protectBrandNames('myGeek')).toBe('myGeek');
  });

  it('Geek 単独でハイフン/句読点に隣接していても拾う', () => {
    expect(protectBrandNames('Geek-app')).toBe('__GEEKBRAND__-app');
    expect(protectBrandNames('Geek, awesome!')).toBe('__GEEKBRAND__, awesome!');
  });

  it('空文字は空文字を返す', () => {
    expect(protectBrandNames('')).toBe('');
  });
});

describe('restoreBrandNames', () => {
  it('placeholder を Geek に戻す', () => {
    expect(restoreBrandNames('__GEEKBRAND__ アプリ')).toBe('Geek アプリ');
  });

  it('複数の placeholder を全て戻す', () => {
    expect(restoreBrandNames('I love __GEEKBRAND__ and __GEEKBRAND__')).toBe('I love Geek and Geek');
  });

  it('lowercase 化された placeholder にも対応 (API が token を lowercase する事故対策)', () => {
    expect(restoreBrandNames('__geekbrand__ app')).toBe('Geek app');
  });

  it('placeholder が無ければそのまま', () => {
    expect(restoreBrandNames('hello world')).toBe('hello world');
  });
});

describe('protect → restore round-trip', () => {
  it('Geek を含む文字列は変換しても元の Geek が残る (no-op を保証)', () => {
    const src = 'Geek アプリで遊ぶ Geek ユーザー';
    expect(restoreBrandNames(protectBrandNames(src))).toBe(src);
  });

  it('Geek が無い文字列は完全に不変', () => {
    const src = '今日もコードを書く一日';
    expect(restoreBrandNames(protectBrandNames(src))).toBe(src);
  });
});
