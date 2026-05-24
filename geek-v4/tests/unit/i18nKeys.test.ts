// ============================================================
// i18n key completeness test
// ============================================================
// Dictionary を直接 import するとプロジェクト本体の循環参照 (stores/languageStore
// → react-native への chain) で jest がモジュール解決に詰まる。
// → STRINGS の構造 (Record<key, Partial<Record<Lang, string>>>) だけ
//   テスト内で再現し、実ファイルの内容と「同じ shape を持つこと」を
//   verify する責務はメンテナでの目視レビュー or future ts-morph 化に任せる。
//
// このテストは「最初のエントリ (canonical) に含まれる lang は、他の全エントリ
// にも含まれていなければならない」というルールを fake fixture で先に検証し、
// 同じロジックを実 dictionary に適用するパターン。
// ============================================================

type LangCode = 'ja' | 'en' | 'ko' | 'zh' | 'th' | 'vi' | 'fr' | 'es';
type Entry = Partial<Record<LangCode, string>>;
type Dict = Record<string, Entry>;

/** dictionary の最初のエントリのキーセットを canonical とみなして、
 *  全エントリに同じ lang が揃っているかを確認する。 */
function findMissing(dict: Dict): { key: string; lang: LangCode }[] {
  const keys = Object.keys(dict);
  if (keys.length === 0) return [];
  const canonical = Object.keys(dict[keys[0]]) as LangCode[];
  const missing: { key: string; lang: LangCode }[] = [];
  for (const k of keys) {
    for (const lang of canonical) {
      if (!(lang in dict[k])) missing.push({ key: k, lang });
    }
  }
  return missing;
}

describe('i18n key completeness — logic', () => {
  it('全エントリに canonical lang セットが揃っているとき空配列を返す', () => {
    const dict: Dict = {
      hello: { ja: 'こんにちは', en: 'hello' },
      bye:   { ja: 'さよなら', en: 'bye' },
    };
    expect(findMissing(dict)).toEqual([]);
  });

  it('missing lang を全部列挙する', () => {
    const dict: Dict = {
      hello: { ja: 'こんにちは', en: 'hello' },
      bye:   { ja: 'さよなら' }, // en 欠落
      yes:   { en: 'yes' },      // ja 欠落
    };
    const m = findMissing(dict);
    expect(m).toEqual(expect.arrayContaining([
      { key: 'bye', lang: 'en' },
      { key: 'yes', lang: 'ja' },
    ]));
    expect(m).toHaveLength(2);
  });

  it('空 dict は no missing', () => {
    expect(findMissing({})).toEqual([]);
  });
});

// ============================================================
// 実 dictionary の sanity (fixture でなく直 import)。
// supabase 連鎖を踏まないシンプルな構造ファイルなので、ここでは直 import OK。
// ============================================================
import { STRINGS } from '../../lib/i18n/dictionary';

describe('i18n key completeness — real dictionary', () => {
  it('実 dictionary の全エントリで canonical lang が揃っている', () => {
    const missing = findMissing(STRINGS as Dict);
    // ❗ 1 つでも欠けていればこのテストが落ちて、欠けたペアを output する。
    // 修正は lib/i18n/dictionary.ts の該当エントリに lang を追加して対応。
    if (missing.length > 0) {
      const summary = missing
        .slice(0, 10)
        .map((m) => `  ${m.key} → ${m.lang}`)
        .join('\n');
      const more = missing.length > 10 ? `\n  ... and ${missing.length - 10} more` : '';
      throw new Error(`Missing translations:\n${summary}${more}`);
    }
    expect(missing).toEqual([]);
  });

  it('全エントリで最低 ja は埋まっている (fallback の安全網)', () => {
    const noJa: string[] = [];
    for (const [k, e] of Object.entries(STRINGS as Dict)) {
      if (!e.ja) noJa.push(k);
    }
    expect(noJa).toEqual([]);
  });
});
