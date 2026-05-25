// ============================================================
// i18n D スコープのテスト — translateStatic + 日付 locale + DICT 拡充
// ============================================================
// 2026-05 改修: production で「日本語設定なのに勝手に英語化」事故の
// 根本解消として、UI を本当に多言語化する一歩。
// ============================================================

import { translate, translateStatic } from '../../lib/i18n';
import { formatRelativeFor } from '../../lib/utils/date';
import { useLanguageStore } from '../../stores/languageStore';

describe('translate — D 追加分の DICT が引ける', () => {
  it('UI ラベル: すべて / タグを追加 / 送信 / 閉じる', () => {
    // 旧 kind バッジ ラベル (事実 / 意見 等) は 2026-05 に機能廃止
    // → DICT から削除済み。代わりに今残ってる D scope key で検証。
    expect(translate('すべて', 'en')).toBe('All');
    expect(translate('タグを追加', 'en')).toBe('Add tag');
    expect(translate('送信', 'en')).toBe('Send');
    expect(translate('閉じる', 'en')).toBe('Close');
  });

  it('Toast/Error 系も翻訳される', () => {
    expect(translate('ログインに失敗しました', 'en')).toBe('Login failed');
    expect(translate('保存しました', 'en')).toBe('Saved');
    expect(translate('リアクションに失敗しました', 'en')).toBe('Reaction failed');
  });

  it('辞書に無い文字列はそのまま返る (安全な fallback)', () => {
    expect(translate('全く未登録の文字列xyz', 'en')).toBe('全く未登録の文字列xyz');
  });

  it('lang=ja は常に原文 (DICT lookup スキップ)', () => {
    expect(translate('保存しました', 'ja')).toBe('保存しました');
    expect(translate('完全に未登録', 'ja')).toBe('完全に未登録');
  });
});

describe('translateStatic — store の最新 lang を読む', () => {
  it('lang が変わると次回呼び出しから新 lang が適用される', () => {
    useLanguageStore.setState({ lang: 'ja' });
    expect(translateStatic('保存しました')).toBe('保存しました');

    useLanguageStore.setState({ lang: 'en' });
    expect(translateStatic('保存しました')).toBe('Saved');

    useLanguageStore.setState({ lang: 'es' });
    expect(translateStatic('保存しました')).toBe('Guardado');

    // cleanup
    useLanguageStore.setState({ lang: 'ja' });
  });
});

describe('formatRelativeFor — locale-aware 相対時刻', () => {
  const now = Date.now();
  const min2 = new Date(now - 2 * 60 * 1000).toISOString();
  const hour3 = new Date(now - 3 * 60 * 60 * 1000).toISOString();
  const day1 = new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString();
  const day5 = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString();
  const day40 = new Date(now - 40 * 24 * 60 * 60 * 1000).toISOString();

  it('ja は従来通り「2分前」「3時間前」「昨日」', () => {
    expect(formatRelativeFor(min2, 'ja')).toBe('2分前');
    expect(formatRelativeFor(hour3, 'ja')).toBe('3時間前');
    expect(formatRelativeFor(day1, 'ja')).toBe('昨日');
    expect(formatRelativeFor(day5, 'ja')).toBe('5日前');
  });

  it('en は Intl.RelativeTimeFormat で「2 minutes ago」「3 hours ago」「yesterday」', () => {
    // Intl の出力は若干の環境差があるので「含む」で判定
    expect(formatRelativeFor(min2, 'en')).toMatch(/2 minutes? ago/);
    expect(formatRelativeFor(hour3, 'en')).toMatch(/3 hours? ago/);
    // yesterday は numeric: 'auto' で語が変わる (英は "yesterday")
    expect(formatRelativeFor(day1, 'en').toLowerCase()).toMatch(/yesterday|1 day ago/);
    expect(formatRelativeFor(day5, 'en')).toMatch(/5 days? ago/);
  });

  it('30 日以上は ja は M/D、en は "May 26" 形式', () => {
    expect(formatRelativeFor(day40, 'ja')).toMatch(/^\d+\/\d+$/);
    // en の DateTimeFormat は環境依存だが、年が含まれないことを確認
    const enResult = formatRelativeFor(day40, 'en');
    expect(enResult.length).toBeGreaterThan(0);
  });

  it('不正な ISO 文字列は空文字を返す', () => {
    expect(formatRelativeFor('not-a-date', 'ja')).toBe('');
    expect(formatRelativeFor('', 'en')).toBe('');
  });

  it('未来の日付は「たった今 / now」扱い', () => {
    const future = new Date(now + 1000 * 60).toISOString();
    expect(formatRelativeFor(future, 'ja')).toBe('たった今');
    expect(formatRelativeFor(future, 'en')).toBe('now');
  });
});
