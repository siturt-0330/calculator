// ============================================================
// Date utilities — zero-dependency, language-aware.
// ============================================================
// 旧版は date-fns + ja locale を top-level import していたため、
// formatRelative しか呼ばれないルートでも 30-50KB が初期バンドルに
// 入っていた。formatRelative は元々 date-fns を使っていない (自前
// ロジック) ので、依存自体を外して bundle に乗らないようにする。
//
// 言語連動 (2026-05-24 追加):
//   ja の場合は従来通り '3時間前' / '昨日' / '先週' 等の自然な日本語表記。
//   ja 以外は Intl.RelativeTimeFormat を使って locale-aware 表記。
//   (例: en → '3 hours ago', es → 'hace 3 horas')
//   言語は useLanguageStore から imperatively 読む。
// ============================================================

import { useLanguageStore, type Lang } from '../../stores/languageStore';

// ISO 文字列を Date に直す軽量パーサ。
function parseISO(dateStr: string): Date {
  return new Date(dateStr);
}

// 自然な日本語の時刻表記 (ja のみ)
// "たった今" / "1分前" / "3時間前" / "昨日" / "3日前" / "先週" / "9/12"
function formatRelativeJa(d: Date, diffMs: number): string {
  const sec = Math.floor(diffMs / 1000);
  if (sec < 0) return 'たった今';
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

// Intl.RelativeTimeFormat を使った非 ja 表記。
// numeric:'auto' で '1 day ago' → 'yesterday' のような自然変換が効く。
// 30 日以上は Intl.DateTimeFormat に切り替え (相対より絶対の方が読みやすい)。
function formatRelativeIntl(d: Date, diffMs: number, lang: Lang): string {
  // Intl は ja 以外をそのまま BCP47 として受け取れる (en/zh/ko/es/fr/th/vi/id)
  try {
    const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
    const sec = Math.round(diffMs / 1000);
    if (Math.abs(sec) < 60) return rtf.format(-sec, 'second');
    const min = Math.round(sec / 60);
    if (Math.abs(min) < 60) return rtf.format(-min, 'minute');
    const hour = Math.round(min / 60);
    if (Math.abs(hour) < 24) return rtf.format(-hour, 'hour');
    const day = Math.round(hour / 24);
    if (Math.abs(day) < 14) return rtf.format(-day, 'day');
    if (Math.abs(day) < 30) return rtf.format(-Math.round(day / 7), 'week');
    // 30 日以上: 絶対日付
    const fmt = new Intl.DateTimeFormat(lang, {
      year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
      month: 'short',
      day: 'numeric',
    });
    return fmt.format(d);
  } catch {
    // Intl が落ちた場合は素朴な fallback
    return d.toISOString().slice(0, 10);
  }
}

export function formatRelative(dateStr: string): string {
  try {
    const d = parseISO(dateStr);
    const diffMs = Date.now() - d.getTime();
    if (Number.isNaN(diffMs)) return '';
    const lang = useLanguageStore.getState().lang;
    if (lang === 'ja') return formatRelativeJa(d, diffMs);
    return formatRelativeIntl(d, diffMs, lang);
  } catch {
    return '';
  }
}

export function formatDate(dateStr: string): string {
  try {
    const d = parseISO(dateStr);
    if (Number.isNaN(d.getTime())) return '';
    const lang = useLanguageStore.getState().lang;
    if (lang === 'ja') {
      return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
    }
    try {
      const fmt = new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'short', day: 'numeric' });
      return fmt.format(d);
    } catch {
      return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
    }
  } catch {
    return '';
  }
}
