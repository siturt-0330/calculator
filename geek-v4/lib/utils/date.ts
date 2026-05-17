import { formatDistanceToNow, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';

// 自然な日本語の時刻表記
// "たった今" / "1分前" / "3時間前" / "昨日" / "3日前" / "先週" / "9/12"
export function formatRelative(dateStr: string): string {
  try {
    const d = parseISO(dateStr);
    const diffMs = Date.now() - d.getTime();
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
    // 30日以上: 年内なら M/D、年跨ぎなら YYYY/M/D
    const now = new Date();
    if (d.getFullYear() === now.getFullYear()) {
      return `${d.getMonth() + 1}/${d.getDate()}`;
    }
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  } catch {
    return '';
  }
}

// 詳細な相対表記 (date-fns 版) — 必要なら使う
export function formatRelativeDetail(dateStr: string): string {
  try {
    return formatDistanceToNow(parseISO(dateStr), { addSuffix: true, locale: ja });
  } catch {
    return '';
  }
}

export function formatDate(dateStr: string): string {
  try {
    const d = parseISO(dateStr);
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  } catch {
    return '';
  }
}
