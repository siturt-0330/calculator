// ============================================================
// Date utilities — zero-dependency.
// ============================================================
// 旧版は date-fns + ja locale を top-level import していたため、
// formatRelative しか呼ばれないルートでも 30-50KB が初期バンドルに
// 入っていた。formatRelative は元々 date-fns を使っていない (自前
// ロジック) ので、依存自体を外して bundle に乗らないようにする。
// formatRelativeDetail はどこからも呼ばれていない (確認済み) ので
// 削除した。再導入する場合は date-fns/formatDistanceToNow を
// その関数内で動的 import すること。
// ============================================================

// ISO 文字列を Date に直す軽量パーサ。
// `new Date(str)` で十分カバーできるが、無効値の場合に NaN になり
// その先で getFullYear() 等が落ちるので try/catch で吸収する。
function parseISO(dateStr: string): Date {
  return new Date(dateStr);
}

// 自然な日本語の時刻表記
// "たった今" / "1分前" / "3時間前" / "昨日" / "3日前" / "先週" / "9/12"
export function formatRelative(dateStr: string): string {
  try {
    const d = parseISO(dateStr);
    const diffMs = Date.now() - d.getTime();
    if (Number.isNaN(diffMs)) return '';
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

export function formatDate(dateStr: string): string {
  try {
    const d = parseISO(dateStr);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  } catch {
    return '';
  }
}
