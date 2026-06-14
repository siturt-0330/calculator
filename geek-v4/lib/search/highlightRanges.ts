// ============================================================
// highlightRanges — 検索語ハイライト用の位置計算 (純関数)
// ------------------------------------------------------------
// 旧 lib/search/scoring.ts から分離。scoring.ts の client BM25 ランカー
// (scorePost 等) は検索ランキングが server RPC (search_posts_v2/v4) に移行して
// dead 化したため削除し、唯一 live だったこの関数だけを切り出した。
// 唯一の利用元: components/ui/HighlightedText.tsx。
// ============================================================

// マッチ部分のハイライト用: テキスト内の用語位置 (merge 済み非重複 range) を返す。
export function findHighlightRanges(text: string, terms: string[]): { start: number; end: number }[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const out: { start: number; end: number }[] = [];
  for (const term of terms) {
    const t = term.toLowerCase();
    if (!t) continue;
    let idx = 0;
    while ((idx = lower.indexOf(t, idx)) !== -1) {
      out.push({ start: idx, end: idx + t.length });
      idx += t.length;
    }
  }
  // 重複・隣接マージ
  out.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  return merged;
}
