// タイポ補正 (Levenshtein distance ベース)
// 既知のタグ名から類似度の高いものを「Did you mean...」として提案

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let cur = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(
        cur[j - 1]! + 1,
        prev[j]! + 1,
        prev[j - 1]! + cost,
      );
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n]!;
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
