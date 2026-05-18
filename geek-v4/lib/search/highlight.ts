// ============================================================
// マッチハイライト
// ============================================================
// タグ文字列とクエリ (またはそのバリエーション) から、
// マッチした部分を bold で示すためのセグメント配列を返す。
// ============================================================

import { normalize } from './tokenize';

export type Segment = {
  text: string;
  highlight: boolean;
};

/**
 * tag のうち、queries の任意の文字列が含まれる部分をハイライト。
 * 複数マッチがあっても重ねて表示できるよう、開始位置でソートしてマージ。
 */
export function highlightTag(tag: string, queries: string[]): Segment[] {
  if (!tag) return [];
  const normTag = normalize(tag);
  const normQueries = queries.map(normalize).filter((q) => q.length >= 1);
  if (normQueries.length === 0) return [{ text: tag, highlight: false }];

  // マッチ範囲を全部見つける (重複も含む)
  type Match = { start: number; end: number };
  const matches: Match[] = [];
  for (const q of normQueries) {
    let idx = 0;
    while (idx <= normTag.length - q.length) {
      const found = normTag.indexOf(q, idx);
      if (found === -1) break;
      matches.push({ start: found, end: found + q.length });
      idx = found + 1;
    }
  }
  if (matches.length === 0) return [{ text: tag, highlight: false }];

  // 重なるマッチをマージ (open intervals)
  matches.sort((a, b) => a.start - b.start);
  const merged: Match[] = [matches[0]!];
  for (let i = 1; i < matches.length; i++) {
    const cur = matches[i]!;
    const last = merged[merged.length - 1]!;
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      merged.push({ ...cur });
    }
  }

  // 正規化前のテキストと位置がズレないように、Length-preserving normalization 前提。
  // (normalize は trim() + toLowerCase 程度なので長さは保たれる前提。日本語は基本そのまま)
  const segments: Segment[] = [];
  let cursor = 0;
  for (const m of merged) {
    if (m.start > cursor) segments.push({ text: tag.slice(cursor, m.start), highlight: false });
    segments.push({ text: tag.slice(m.start, m.end), highlight: true });
    cursor = m.end;
  }
  if (cursor < tag.length) segments.push({ text: tag.slice(cursor), highlight: false });
  return segments;
}
