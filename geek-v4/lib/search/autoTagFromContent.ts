// ============================================================
// 投稿本文から自動でタグを提案する
// ============================================================
// 入力: ユーザーが書いた本文 (例: "大谷選手のホームラン40本目!")
// 出力: 候補タグ配列 (例: ["大谷翔平", "野球", "MLB", "ドジャース"])
//
// アルゴリズム:
//   1. 本文を tokenize (空白分割 + 既知タグ部分一致)
//   2. 各候補タグについて、本文内での出現を検出:
//      a. 完全一致
//      b. variant (同義語) 一致
//      c. 字面類似 (Damerau >= 0.7)
//      d. 共起シグナル: マッチしたタグの cooccur top-N も候補に
//   3. V3 のシグナルでスコアリング (PMI + 人気度 + トレンド)
//   4. ダイバーシフィケーション + Top-N
// ============================================================

import type { TagNode } from '@/stores/tagGraphStore';
import type { EmbeddingVector } from './embeddings';
import { generateVariants } from './variants';
import { normalize } from './tokenize';
import { similarity as damerauSimilarity } from './typoCorrect';
import { cosineSim } from './embeddings';

export type AutoTagSuggestion = {
  tag: string;
  score: number;
  reason: string;
  matchedText?: string;  // 本文のどの部分にマッチしたか
};

export type AutoTagContext = {
  allTags: string[];
  nodes: Record<string, TagNode>;
  cooccur: Record<string, Record<string, number>>;
  tagPopularity: Record<string, number>;
  embeddings: Map<string, EmbeddingVector>;
  trendingTags?: Set<string>;
};

export function suggestTagsFromContent(
  content: string,
  ctx: AutoTagContext,
  opts: { limit?: number; minLen?: number } = {},
): AutoTagSuggestion[] {
  const limit = opts.limit ?? 8;
  const minLen = opts.minLen ?? 10;  // 短すぎる本文には適用しない

  if (!content || content.length < minLen) return [];
  const lower = content.toLowerCase();

  // 候補プール (full tag list + graph labels + aliases)
  const candidateSet = new Set<string>();
  for (const t of ctx.allTags) candidateSet.add(t);
  for (const n of Object.values(ctx.nodes)) {
    candidateSet.add(n.label);
    for (const a of n.aliases) candidateSet.add(a);
  }
  for (const t of Object.keys(ctx.tagPopularity)) candidateSet.add(t);

  const scored = new Map<string, { score: number; reason: string; matchedText?: string }>();

  const push = (tag: string, score: number, reason: string, matched?: string) => {
    const cur = scored.get(tag);
    if (!cur || cur.score < score) {
      scored.set(tag, { score, reason, matchedText: matched ?? cur?.matchedText });
    }
  };

  // (1) 直接マッチ
  for (const tag of candidateSet) {
    const tn = normalize(tag);
    if (tn.length < 2) continue;
    // 完全に本文に含まれる
    if (lower.includes(tn) || content.includes(tag)) {
      push(tag, 200, '本文に含む', tag);
      continue;
    }
    // Variant マッチ (=LOVE → 本文に「イコラブ」)
    const variants = generateVariants(tag);
    for (const v of variants) {
      const vn = normalize(v);
      if (vn.length < 2) continue;
      if (lower.includes(vn)) {
        push(tag, 150, '別表記で含む', v);
        break;
      }
    }
  }

  // (2) ファジーマッチ (本文を 2-4 文字スライドして候補と比較)
  // 計算量を抑えるため、まだスコア入りしていない上位人気タグだけ対象
  const remaining = [...candidateSet]
    .filter((t) => !scored.has(t))
    .sort((a, b) => (ctx.tagPopularity[b] ?? 0) - (ctx.tagPopularity[a] ?? 0))
    .slice(0, 100);
  for (const tag of remaining) {
    const tn = normalize(tag);
    if (tn.length < 3 || tn.length > 12) continue;
    const winLen = tn.length;
    for (let i = 0; i + winLen <= lower.length; i++) {
      const window = lower.slice(i, i + winLen);
      const sim = damerauSimilarity(window, tn);
      if (sim >= 0.75) {
        push(tag, 80 + sim * 50, 'ほぼ一致', content.slice(i, i + winLen));
        break;
      }
    }
  }

  // (3) 共起 + PMI 拡張: 既にマッチしたタグの近傍を候補に
  const matchedTags = [...scored.keys()];
  for (const seed of matchedTags) {
    // 共起 top-5
    const coo = ctx.cooccur[seed];
    if (coo) {
      const top = Object.entries(coo).sort((a, b) => b[1] - a[1]).slice(0, 5);
      for (const [other, cnt] of top) {
        if (scored.has(other)) continue;
        push(other, Math.log(1 + cnt) * 10, 'よく一緒に使う', undefined);
      }
    }
    // PMI top-5
    const seedEmb = ctx.embeddings.get(seed);
    if (seedEmb) {
      const sims: Array<{ tag: string; sim: number }> = [];
      for (const [other, vec] of ctx.embeddings) {
        if (other === seed || scored.has(other)) continue;
        const s = cosineSim(seedEmb, vec);
        if (s >= 0.25) sims.push({ tag: other, sim: s });
      }
      sims.sort((a, b) => b.sim - a.sim);
      for (const s of sims.slice(0, 5)) {
        push(s.tag, s.sim * 60, '意味的関連', undefined);
      }
    }
  }

  // (4) ブースト
  for (const [tag, entry] of scored) {
    const pop = ctx.tagPopularity[tag] ?? 0;
    if (pop > 0) entry.score += Math.log(1 + pop) * 2;
    if (ctx.trendingTags?.has(tag)) {
      entry.score += 30;
    }
  }

  // ソート + ダイバーシフィケーション
  const sorted = [...scored.entries()]
    .map(([tag, e]) => ({ tag, score: e.score, reason: e.reason, matchedText: e.matchedText }))
    .sort((a, b) => b.score - a.score);

  const picked: AutoTagSuggestion[] = [];
  for (const s of sorted) {
    if (picked.length >= limit) break;
    const tooSimilar = picked.some((p) =>
      damerauSimilarity(normalize(p.tag), normalize(s.tag)) >= 0.85,
    );
    if (tooSimilar) continue;
    picked.push(s);
  }
  return picked;
}
