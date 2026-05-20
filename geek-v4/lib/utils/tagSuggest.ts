import type { TagNode } from '../../stores/tagGraphStore';

export type TagSuggestion = {
  tag: string;
  reason: 'related' | 'sibling' | 'child' | 'parent' | 'group' | 'fuzzy' | 'popular';
  via: string;  // どのノード経由か
};

/**
 * タグツリー + ファジーマッチをベースに「これもどうですか？」サジェストを生成
 *
 * 戦略:
 * 1. 完全一致: liked タグが graph ノード or その alias と一致したら、そのノードの related/sibling/child/parent を提案
 * 2. ファジー一致: liked タグが graph ノードのラベル/別名/関連と部分一致したら、そのノードの related/aliases を提案
 *    例: liked = "乃木坂" → graph に "乃木坂46" があれば、乃木坂46 のグループ全体を提案
 * 3. フォールバック: 上の結果が少ない場合、ルートノードを「未開拓ジャンル」として追加
 */
export function buildTagSuggestions(
  likedTags: string[],
  nodes: Record<string, TagNode>,
  rootIds: string[],
  limit = 30,
): TagSuggestion[] {
  const likedSet = new Set(likedTags);
  const suggestions: TagSuggestion[] = [];
  const seenTag = new Set<string>(likedSet);

  // 親 ID マップ
  const parentOf: Record<string, string> = {};
  for (const [id, n] of Object.entries(nodes)) {
    for (const c of n.children) parentOf[c] = id;
  }

  const push = (tag: string, reason: TagSuggestion['reason'], via: string) => {
    const clean = tag.trim();
    if (!clean || seenTag.has(clean)) return;
    seenTag.add(clean);
    suggestions.push({ tag: clean, reason, via });
  };

  // ====== Tier 1: 完全一致 ======
  const exactMatched: TagNode[] = [];
  for (const n of Object.values(nodes)) {
    if (likedSet.has(n.label) || n.aliases.some((a) => likedSet.has(a))) {
      exactMatched.push(n);
    }
  }

  for (const node of exactMatched) {
    for (const r of node.related ?? []) push(r, 'related', node.label);
    for (const cid of node.children) {
      const c = nodes[cid];
      if (c) push(c.label, 'child', node.label);
    }
    const pid = parentOf[node.id];
    if (pid) {
      const parent = nodes[pid];
      if (parent) {
        push(parent.label, 'parent', node.label);
        for (const sid of parent.children) {
          if (sid === node.id) continue;
          const s = nodes[sid];
          if (s) push(s.label, 'sibling', parent.label);
        }
      }
    }
  }

  // ====== Tier 2: ファジー一致 (substring) ======
  // liked タグ毎に graph 内のノードと部分一致を試す
  const exactMatchedIds = new Set(exactMatched.map((n) => n.id));
  const norm = (s: string) => s.trim().toLowerCase();
  for (const liked of likedTags) {
    const ql = norm(liked);
    if (ql.length < 2) continue;
    for (const n of Object.values(nodes)) {
      if (exactMatchedIds.has(n.id)) continue;
      const allTexts = [n.label, ...n.aliases, ...(n.related ?? [])].map(norm);
      const isFuzzy = allTexts.some(
        (s) => s !== ql && (s.includes(ql) || ql.includes(s)),
      );
      if (!isFuzzy) continue;
      // この graph ノードはユーザーの liked と関係ありそう → 提案
      push(n.label, 'fuzzy', liked);
      for (const a of n.aliases) push(a, 'fuzzy', liked);
      for (const r of n.related ?? []) push(r, 'related', n.label);
      // ファジー一致したノードの兄弟も少し提案
      const pid = parentOf[n.id];
      if (pid) {
        const parent = nodes[pid];
        if (parent) {
          for (const sid of parent.children.slice(0, 4)) {
            if (sid === n.id) continue;
            const s = nodes[sid];
            if (s) push(s.label, 'sibling', parent.label);
          }
        }
      }
    }
  }

  // ====== Tier 3: フォールバック (ルートから提案) ======
  // suggestion が少なすぎる、または liked が空のときに graph のルートから探検
  const shortage = suggestions.length < Math.min(6, Math.floor(limit / 3));
  if (shortage || likedSet.size === 0) {
    for (const rid of rootIds) {
      const n = nodes[rid];
      if (!n) continue;
      push(n.label, 'group', 'ツリー');
      // ルート直下のいくつかも
      for (const cid of n.children.slice(0, 3)) {
        const c = nodes[cid];
        if (c) push(c.label, 'group', n.label);
      }
      if (suggestions.length >= limit) break;
    }
  }

  return suggestions.slice(0, limit);
}

export const REASON_LABEL: Record<TagSuggestion['reason'], { icon: string; label: string; color: string }> = {
  related: { icon: '🔗', label: '関連', color: '#7CB1FF' },
  sibling: { icon: '↔', label: '同グループ', color: '#22D3A4' },
  child:   { icon: '↳', label: '下位', color: '#F472B6' },
  parent:  { icon: '↑', label: '上位', color: '#FCD34D' },
  group:   { icon: '📁', label: 'グループ', color: '#7C6AF7' },
  fuzzy:   { icon: '∼', label: '類似', color: '#FF9F6B' },
  popular: { icon: '🔥', label: '人気', color: '#FF6B7A' },
};
