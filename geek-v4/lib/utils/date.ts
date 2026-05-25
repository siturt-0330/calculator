// ============================================================
// Date utilities — locale-aware (zero external dependency)
// ============================================================
// 旧版は ja 固定で "3時間前" / "昨日" 等を出していた。lang が en の user に
// 「先週」と出ると意味不明なので、Intl.RelativeTimeFormat で locale に
// 合わせて変換する (Intl はランタイム標準内蔵、bundle 増加ゼロ)。
//
// 設計判断:
//   - ja は従来通り (Intl が出す "3 時間前" は自然だが、慣れた表記を維持)
//     カスタムフォーマットで "たった今" "昨日" "先週" を維持
//   - 非 ja は Intl.RelativeTimeFormat(lang) を使用
//     "3 hours ago" / "hace 3 horas" / "3시간 전" 等が自動生成
//   - 30 日以上は Intl.DateTimeFormat(lang) で絶対日付 (locale 別の月日表記)
// ============================================================

import { useLanguageStore, type Lang } from '../../stores/languageStore';

function parseISO(dateStr: string): Date {
  return new Date(dateStr);
}

// JA 固定の自然な日本語表記 (従来挙動)
function formatRelativeJa(d: Date, diffMs: number): string {
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return 'たった今';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}時間前`;
  const day = Math.floor(hour / 24);
  if (day === 1) return '昨日';
  if (day < 7) return `${day}日前`;
  if (day < 14) return '先週';
  if (day < 30) return `${Math.floor(day / 7)}週間前`;
  // 30 日以上: 年内なら M/D、年跨ぎなら YYYY/M/D
  const now = new Date();
  if (d.getFullYear() === now.getFullYear()) {
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

// Intl ベースの locale-aware 表記 (非 JA)
function formatRelativeIntl(d: Date, diffMs: number, lang: Lang): string {
  try {
    const sec = Math.floor(diffMs / 1000);
    const min = Math.floor(sec / 60);
    const hour = Math.floor(min / 60);
    const day = Math.floor(hour / 24);
    // 30 日以上は絶対日付 (locale 別フォーマット)
    if (day >= 30) {
      const sameYear = d.getFullYear() === new Date().getFullYear();
      return new Intl.DateTimeFormat(lang, {
        year: sameYear ? undefined : 'numeric',
        month: 'short',
        day: 'numeric',
      }).format(d);
    }
    const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
    if (sec < 60) return rtf.format(0, 'second'); // "now" / "ahora" etc.
    if (min < 60) return rtf.format(-min, 'minute');
    if (hour < 24) return rtf.format(-hour, 'hour');
    if (day < 7) return rtf.format(-day, 'day');
    return rtf.format(-Math.floor(day / 7), 'week');
  } catch {
    // 古い RN runtime で Intl 非対応の保険
    return d.toLocaleDateString();
  }
}

// React 外でも呼べる: lang を引数で受ける版
export function formatRelativeFor(dateStr: string, lang: Lang): string {
  try {
    const d = parseISO(dateStr);
    const diffMs = Date.now() - d.getTime();
    if (Number.isNaN(diffMs)) return '';
    if (diffMs < 0) return lang === 'ja' ? 'たった今' : 'now';
    if (lang === 'ja') return formatRelativeJa(d, diffMs);
    return formatRelativeIntl(d, diffMs, lang);
  } catch {
    return '';
  }
}

// 既存 caller 互換: store の最新 lang を毎回読む。
// ★ React component から呼ぶ場合は本関数で問題ないが、頻繁に呼ぶ場面では
//   useLanguageStore を hook で購読して formatRelativeFor を直接使うほうが
//   re-render コストが軽い。
export function formatRelative(dateStr: string): string {
  const lang = useLanguageStore.getState().lang;
  return formatRelativeFor(dateStr, lang);
}

// 絶対日付 (locale-aware)
export function formatDate(dateStr: string): string {
  const lang = useLanguageStore.getState().lang;
  try {
    const d = parseISO(dateStr);
    if (Number.isNaN(d.getTime())) return '';
    if (lang === 'ja') {
      return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
    }
    return new Intl.DateTimeFormat(lang, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(d);
  } catch {
    return '';
  }
}
