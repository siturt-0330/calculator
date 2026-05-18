// ============================================================
// N-gram Inverted Index
// ============================================================
// 各タグを 2-gram と 3-gram に分解して逆引きインデックスを構築。
// クエリの n-gram と共通する n-gram を持つタグだけが候補となるので、
// 線形スキャン (O(N tags)) から O(query length * avg ngram occurrences) に。
//
// 数百タグ規模なら数 ms 以下で候補絞り込み完了。
// ============================================================

import { normalize } from './tokenize';

export type Candidate = {
  tag: string;
  matchedNgrams: number;  // 共通 n-gram の個数 (高いほど類似)
};

export class NgramIndex {
  private index: Map<string, Set<string>> = new Map();
  private allTags: Set<string> = new Set();

  add(tag: string): void {
    if (this.allTags.has(tag)) return;
    this.allTags.add(tag);
    const normalized = normalize(tag);
    for (const ng of this.ngrams(normalized)) {
      let set = this.index.get(ng);
      if (!set) {
        set = new Set();
        this.index.set(ng, set);
      }
      set.add(tag);
    }
  }

  build(tags: Iterable<string>): void {
    for (const t of tags) this.add(t);
  }

  /**
   * クエリ文字列から候補タグを返す (共通 n-gram の個数つき)
   */
  query(text: string, minNgrams = 1): Candidate[] {
    const normalized = normalize(text);
    const counts: Map<string, number> = new Map();
    const seen = new Set<string>();
    for (const ng of this.ngrams(normalized)) {
      // 同じ ngram を二度数えない (input 内で繰り返しても 1 として扱う)
      if (seen.has(ng)) continue;
      seen.add(ng);
      const tags = this.index.get(ng);
      if (!tags) continue;
      for (const t of tags) {
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    const result: Candidate[] = [];
    for (const [tag, c] of counts) {
      if (c >= minNgrams) result.push({ tag, matchedNgrams: c });
    }
    return result;
  }

  // 全タグ取得 (低スコア候補を補完する fallback 用)
  getAllTags(): string[] {
    return [...this.allTags];
  }

  size(): number {
    return this.allTags.size;
  }

  // 2-gram と 3-gram を yield
  private *ngrams(s: string): IterableIterator<string> {
    if (s.length === 1) {
      yield s;  // 1文字は1-gram も登録
      return;
    }
    for (let i = 0; i <= s.length - 2; i++) yield s.slice(i, i + 2);
    for (let i = 0; i <= s.length - 3; i++) yield s.slice(i, i + 3);
  }
}
