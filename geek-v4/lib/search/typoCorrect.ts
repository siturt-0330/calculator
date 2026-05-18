// タイポ補正 (Damerau-Levenshtein distance ベース)
// 既知のタグ名から類似度の高いものを「Did you mean...」として提案
// Damerau-Levenshtein: 隣接2文字の入れ替え (transposition) を 1 操作として扱う
//   例: "ポケモソ" → "ポケモン" は通常の Levenshtein なら 1 (substitute)、
//       "ポケンモ" → "ポケモン" も通常なら 2 だが、Damerau なら 1 (transpose)

function damerauLevenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  // 3行を使い回す (一つ前 + 二つ前)
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i]![0] = i;
  for (let j = 0; j <= n; j++) d[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(
        d[i - 1]![j]! + 1,       // delete
        d[i]![j - 1]! + 1,       // insert
        d[i - 1]![j - 1]! + cost, // substitute
      );
      // transposition: a[i-2..i-1] と b[j-2..j-1] が swap してたら +1 で OK
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
      }
    }
  }
  return d[m]![n]!;
}

// 互換性のため旧名でもエクスポート
function levenshtein(a: string, b: string): number {
  return damerauLevenshtein(a, b);
}

// 類似度 (0-1, 1が同一)
export function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const dist = levenshtein(a.toLowerCase(), b.toLowerCase());
  return 1 - dist / maxLen;
}

// 候補から最も類似度の高いものを返す (一定閾値以上のみ)
export function findClosest(query: string, candidates: string[], minSim = 0.6): string | null {
  if (!query || candidates.length === 0) return null;
  let best: { tag: string; sim: number } | null = null;
  for (const c of candidates) {
    if (c.toLowerCase() === query.toLowerCase()) return null; // 完全一致なら補正不要
    const sim = similarity(query, c);
    if (sim >= minSim && (!best || sim > best.sim)) {
      best = { tag: c, sim };
    }
  }
  return best?.tag ?? null;
}

// 上位 K 件を返す
export function findClosestK(query: string, candidates: string[], k = 5, minSim = 0.5): string[] {
  const scored: { tag: string; sim: number }[] = [];
  for (const c of candidates) {
    if (c.toLowerCase() === query.toLowerCase()) continue;
    const sim = similarity(query, c);
    if (sim >= minSim) scored.push({ tag: c, sim });
  }
  scored.sort((a, b) => b.sim - a.sim);
  return scored.slice(0, k).map((s) => s.tag);
}
