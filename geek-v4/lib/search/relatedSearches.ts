// ============================================================
// Related Searches Generator (Google-style "Related queries")
// ============================================================
// 入力クエリ Q について、関連する検索クエリ候補を返す。
// シグナル:
//   1. 過去のユーザークリック履歴 (Q を入力した人が次に何を入力したか)
//   2. タグ連携グラフ: Q のタグの sibling/related から
//   3. PMI コサイン類似度の上位タグ
//   4. 共起タグ
// ============================================================

import type { TagNode } from '@/stores/tagGraphStore';
import type { EmbeddingVector } from './embeddings';
import { cosineSim } from './embeddings';
import { normalize } from './tokenize';

export type RelatedQuery = {
  query: string;
  reason: string;
  score: number;
};

export type RelatedContext = {
  nodes: Record<string, TagNode>;
  cooccur: Record<string, Record<string, number>>;
  embeddings: Map<string, EmbeddingVector>;
  recentQueries?: string[];
  clickStats?: Record<string, Record<string, number>>;  // query → tag → count
};

export function generateRelatedQueries(
  query: string,
  ctx: RelatedContext,
  limit = 8,
): RelatedQuery[] {
  const qn = normalize(query);
  if (qn.length < 1) return [];

  const out: RelatedQuery[] = [];
  const seen = new Set<string>([qn]);

  const push = (q: string, reason: string, score: number) => {
    const k = normalize(q);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push({ query: q, reason, score });
  };

  // (1) ユーザークリック履歴: 過去に Q を入力した人がよくクリックしたタグ
  const clicks = ctx.clickStats?.[qn];
  if (clicks) {
    const sorted = Object.entries(clicks).sort((a, b) => b[1] - a[1]).slice(0, 4);
    for (const [tag, count] of sorted) {
      push(tag, 'よく一緒に検索', 100 + count * 10);
    }
  }

  // (2) タググラフから sibling / related
  for (const n of Object.values(ctx.nodes)) {
    const allNames = [n.label, ...n.aliases];
    if (allNames.some((s) => normalize(s) === qn)) {
      // 同じ親の sibling
      for (const child of n.children) {
        const c = ctx.nodes[child];
        if (c) push(c.label, '同グループ', 70);
      }
      // related (graph)
      for (const r of n.related ?? []) {
        push(r, '関連タグ', 60);
      }
    }
  }

  // (3) PMI コサイン類似度の上位タグ
  const qEmb = ctx.embeddings.get(query);
  if (qEmb) {
    const scored: Array<{ tag: string; sim: number }> = [];
    for (const [tag, vec] of ctx.embeddings) {
      if (tag === query) continue;
      const sim = cosineSim(qEmb, vec);
      if (sim >= 0.2) scored.push({ tag, sim });
    }
    scored.sort((a, b) => b.sim - a.sim);
    for (const s of scored.slice(0, 5)) {
      push(s.tag, '意味的関連', Math.round(s.sim * 80));
    }
  }

  // (4) 共起タグ上位
  const coo = ctx.cooccur[query];
  if (coo) {
    const sorted = Object.entries(coo).sort((a, b) => b[1] - a[1]).slice(0, 5);
    for (const [tag, count] of sorted) {
      push(tag, 'よく一緒に', 30 + Math.log(1 + count) * 5);
    }
  }

  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}
