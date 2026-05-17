// 検索スコアリング & ランキングアルゴリズム
import type { TagNode } from '@/stores/tagGraphStore';

export type ScoredItem<T> = { item: T; score: number; reasons: string[] };

/**
 * 部分マッチを多角的に評価:
 * - 完全一致 (大文字小文字無視)
 * - 前方一致
 * - 部分一致
 * - 文字含有率 (短いキーワードでも 高ランクに反映)
 */
export function textRelevance(text: string, query: string): number {
  if (!text || !query) return 0;
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (t.includes(q)) {
    const ratio = q.length / t.length;
    return 50 + ratio * 30;
  }
  // 文字単位のオーバーラップ (ファジー)
  let overlap = 0;
  for (const ch of q) if (t.includes(ch)) overlap++;
  return (overlap / q.length) * 20;
}

/**
 * タグツリーから検索クエリに関連するタグを引き出す
 * - クエリが node.label, alias, related のいずれかに含まれる場合
 * - そのノードの兄弟・関連・子も候補に
 */
export function expandWithTagGraph(
  query: string,
  nodes: Record<string, TagNode>,
): { tag: string; reason: string }[] {
  const q = query.toLowerCase();
  if (q.length < 1) return [];
  const expanded: { tag: string; reason: string }[] = [];
  const seen = new Set<string>([query]);

  const parentOf: Record<string, string> = {};
  for (const [id, n] of Object.entries(nodes)) {
    for (const c of n.children) parentOf[c] = id;
  }

  const push = (tag: string, reason: string) => {
    const t = tag.trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    expanded.push({ tag: t, reason });
  };

  for (const n of Object.values(nodes)) {
    const haystack = [n.label, ...n.aliases, ...(n.related ?? [])];
    const hit = haystack.some((s) => s.toLowerCase().includes(q));
    if (!hit) continue;
    // この node が関連する
    push(n.label, '一致');
    for (const a of n.aliases) push(a, '別名');
    for (const r of n.related ?? []) push(r, '関連');
    // 子も
    for (const cid of n.children) {
      const c = nodes[cid];
      if (c) push(c.label, '下位');
    }
    // 兄弟も
    const pid = parentOf[n.id];
    if (pid) {
      const parent = nodes[pid];
      if (parent) {
        for (const sid of parent.children.slice(0, 4)) {
          if (sid === n.id) continue;
          const s = nodes[sid];
          if (s) push(s.label, '同グループ');
        }
      }
    }
  }
  return expanded;
}

/**
 * 投稿の総合スコア
 * - 本文の関連度
 * - タグの関連度 (重み2倍)
 * - いいね/コメント数 (人気度)
 * - 新しさ (時間減衰)
 * - 信頼スコア
 */
export function scorePost(
  post: {
    content: string;
    tag_names: string[];
    likes_count: number;
    comments_count: number;
    created_at: string;
    trust_score_at_post: number;
    concern_count?: number;
  },
  query: string,
  expandedTags: Set<string>,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // 本文関連度
  const contentRel = textRelevance(post.content, query);
  if (contentRel > 0) {
    score += contentRel;
    if (contentRel >= 50) reasons.push('本文一致');
  }

  // タグ関連度 (拡張タグも含む)
  for (const tag of post.tag_names) {
    if (tag.toLowerCase() === query.toLowerCase()) {
      score += 120;
      reasons.push(`#${tag}`);
    } else if (tag.toLowerCase().includes(query.toLowerCase())) {
      score += 70;
      reasons.push(`#${tag}`);
    } else if (expandedTags.has(tag)) {
      score += 40;
      reasons.push(`関連#${tag}`);
    }
  }

  // 人気度 (logarithmic to avoid totally dominating)
  const popularity = Math.log(1 + post.likes_count + post.comments_count * 2) * 8;
  score += popularity;

  // 時間減衰 (24h で半減)
  const ageHours = (Date.now() - new Date(post.created_at).getTime()) / (1000 * 60 * 60);
  const freshness = 30 * Math.exp(-ageHours / 24);
  score += freshness;
  if (ageHours < 24) reasons.push('新着');

  // 信頼スコア
  if (post.trust_score_at_post >= 70) {
    score += 15;
  } else if (post.trust_score_at_post < 30) {
    score -= 25;
  }

  // 気になるが多い投稿はペナルティ
  if ((post.concern_count ?? 0) > post.likes_count + 3) {
    score -= 30;
  }

  return { score: Math.max(0, score), reasons: [...new Set(reasons)].slice(0, 3) };
}

/**
 * タグの関連スコア
 */
export function scoreTag(
  tag: { name: string; post_count?: number; member_count?: number },
  query: string,
  expandedTags: Set<string>,
): number {
  const rel = textRelevance(tag.name, query);
  let score = rel * 2; // ベース倍率
  if (expandedTags.has(tag.name)) score += 30;
  score += Math.log(1 + (tag.member_count ?? 0)) * 5;
  score += Math.log(1 + (tag.post_count ?? 0)) * 3;
  return score;
}
