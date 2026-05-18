// ============================================================
// Trie (Prefix Tree) — Lightning-fast prefix completion
// ============================================================
// 文字単位のツリー構造。各ノードに「ここで終わるキー」と「人気度」を保持。
// クエリ prefix を辿るだけで O(prefix length) でその subtree を発見、
// 子孫の中から popularity 上位 K 件を返す。
// N-gram より厳密な prefix match なので予測補完にぴったり。
// ============================================================

type TrieNode = {
  children: Map<string, TrieNode>;
  // このノードで終わるタグ群 (大文字小文字違いを許容)
  ends: { tag: string; popularity: number }[];
  // subtree の人気度の最大値 (枝刈りに使う)
  maxSubPop: number;
};

function newNode(): TrieNode {
  return { children: new Map(), ends: [], maxSubPop: 0 };
}

export class Trie {
  private root: TrieNode = newNode();

  insert(tag: string, popularity = 0): void {
    let node = this.root;
    const key = tag.toLowerCase();
    for (const ch of key) {
      let next = node.children.get(ch);
      if (!next) {
        next = newNode();
        node.children.set(ch, next);
      }
      node = next;
      if (popularity > node.maxSubPop) node.maxSubPop = popularity;
    }
    node.ends.push({ tag, popularity });
  }

  build(entries: Array<{ tag: string; popularity?: number }>): void {
    for (const e of entries) this.insert(e.tag, e.popularity ?? 0);
  }

  // 指定 prefix で始まる候補を popularity 降順で K 件
  completions(prefix: string, limit = 8): Array<{ tag: string; popularity: number }> {
    if (!prefix) return [];
    let node = this.root;
    for (const ch of prefix.toLowerCase()) {
      const next = node.children.get(ch);
      if (!next) return [];
      node = next;
    }
    // subtree を BFS で収集 (人気度 priority queue 風に処理)
    const collected: Array<{ tag: string; popularity: number }> = [];
    const stack: TrieNode[] = [node];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      for (const e of cur.ends) collected.push(e);
      // 人気の高そうな子から探索 (子の maxSubPop で降順)
      const sorted = [...cur.children.values()].sort((a, b) => b.maxSubPop - a.maxSubPop);
      for (const c of sorted) stack.push(c);
    }
    collected.sort((a, b) => b.popularity - a.popularity);
    return collected.slice(0, limit);
  }

  size(): number {
    let count = 0;
    const stack: TrieNode[] = [this.root];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      count += cur.ends.length;
      for (const c of cur.children.values()) stack.push(c);
    }
    return count;
  }
}
