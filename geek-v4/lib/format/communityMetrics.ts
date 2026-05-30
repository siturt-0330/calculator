/**
 * コミュニティ指標の表示用フォーマッタ。
 * 純粋な TypeScript モジュール（React 依存なし）。
 */

/**
 * 数値を日本語のコンパクト表記に変換する。
 * 常に切り捨て（FLOOR）し、決して切り上げない。末尾の ".0" は除去する。
 *
 * - 有限でない、または負の値 → '0'
 * - n < 10000              → 桁区切り（例: 8420 → "8,420"）
 * - 10000 ≤ n < 100000     → 小数1桁の「万」切り捨て（例: 12400 → "1.2万", 20000 → "2万"）
 * - 100000 ≤ n < 1億       → 整数の「万」切り捨て（例: 124000 → "12万"）
 * - n ≥ 1億                → 小数1桁の「億」切り捨て（例: 120000000 → "1.2億", 100000000 → "1億"）
 *
 * @param n フォーマット対象の数値
 * @returns 日本語のコンパクト表記文字列
 */
export function formatCountJa(n: number): string {
  if (!isFinite(n) || n < 0) {
    return '0';
  }

  if (n < 10000) {
    return n.toLocaleString('ja-JP');
  }

  if (n < 100000) {
    // 小数1桁の「万」切り捨て（例: 12400 → 1.2, 20000 → 2）
    const value = Math.floor(n / 1000) / 10;
    return stripTrailingZero(value) + '万';
  }

  if (n < 100000000) {
    // 整数の「万」切り捨て（例: 124000 → 12）
    return Math.floor(n / 10000) + '万';
  }

  // 小数1桁の「億」切り捨て（例: 120000000 → 1.2, 100000000 → 1）
  const value = Math.floor(n / 10000000) / 10;
  return stripTrailingZero(value) + '億';
}

/**
 * 末尾の ".0" を取り除く（例: 2.0 → "2", 1.2 → "1.2"）。
 */
function stripTrailingZero(value: number): string {
  const s = value.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

/**
 * コミュニティの last_post_at などの相対時刻を短い日本語表記に変換する。
 * null / undefined / 無効な日時 → ''。
 *
 * - 60秒未満  → 'たった今'
 * - 60分未満  → `${minutes}分前`
 * - 24時間未満 → `${hours}時間前`
 * - 7日未満   → `${days}日前`
 * - それ以上  → `${M}/${D}`（先頭ゼロなしの月/日）
 *
 * @param iso ISO 8601 形式の日時文字列
 * @returns 相対時刻の日本語表記文字列
 */
export function formatRelativeTimeJa(iso: string | null | undefined): string {
  if (iso == null) {
    return '';
  }

  const then = new Date(iso).getTime();
  if (!isFinite(then)) {
    return '';
  }

  const diffMs = Date.now() - then;
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) {
    return 'たった今';
  }

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return `${diffMin}分前`;
  }

  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) {
    return `${diffHour}時間前`;
  }

  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) {
    return `${diffDay}日前`;
  }

  const date = new Date(then);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}
