// 検索結果のランキングスコア (BM25 + シグナル + パーソナライゼーション)
import { normalize, tokenize, katakanaToHiragana, hiraganaToKatakana } from './tokenize';
import type { ParsedQuery } from './queryParser';

const BM25_K1 = 1.5;
const BM25_B = 0.75;
const AVG_DOC_LEN = 100;

export type PostDoc = {
  id: string;
  content: string;
  tag_names: string[];
  likes_count: number;
  comments_count: number;
  concern_count: number;
  created_at: string;
  trust_score_at_post: number;
  media_urls: string[];
  source_url: string | null;
  kind?: string | null;
};

export type ScoreInfo = {
  score: number;
  reasons: string[];
  fieldHits: { content: number; tags: number; phrase: number };
};

export type PersonalizationCtx = {
  likedTags: Set<string>;
  blockedTags: Set<string>;
  recentQueries: string[];
  /** タグの閲覧頻度 (decay 済み) — クリック追跡から */
  tagAffinity: Record<string, number>;
  /** 直近に閲覧したタグ */
  recentTags: string[];
};

// BM25 component: a single term within a single document field
function bm25Field(term: string, fieldText: string, fieldWeight = 1, avgLen = AVG_DOC_LEN): number {
  if (!term || !fieldText) return 0;
  const t = normalize(term);
  const docNorm = normalize(fieldText);
  const docLen = Math.max(1, docNorm.length);
  // term frequency (出現回数)
  let tf = 0;
  let idx = 0;
  while (idx !== -1) {
    idx = docNorm.indexOf(t, idx);
    if (idx === -1) break;
    tf++;
    idx += t.length;
  }
  if (tf === 0) {
    // カタカナ↔ひらがな ゆらぎでも試行 (1/2 重み)
    const tHi = katakanaToHiragana(t);
    const tKa = hiraganaToKatakana(t);
    const docHi = katakanaToHiragana(docNorm);
    if (tHi !== t && docHi.includes(tHi)) tf = 0.5;
    else if (tKa !== t && docNorm.includes(tKa)) tf = 0.5;
    else return 0;
  }
  // BM25 standard
  const idf = 1.5; // 簡易: 全文書数を取らず固定値
  const denom = tf + BM25_K1 * (1 - BM25_B + BM25_B * (docLen / avgLen));
  const score = idf * (tf * (BM25_K1 + 1)) / denom;
  return score * fieldWeight;
}

export function scorePost(
  post: PostDoc,
  query: ParsedQuery,
  expandedTags: Set<string>,
  ctx: PersonalizationCtx,
): ScoreInfo {
  const reasons: string[] = [];
  let total = 0;
  let contentHits = 0;
  let tagHits = 0;
  let phraseHits = 0;

  const terms = [...query.keywords];
  const phrases = query.phrases;

  // 除外語があったら 0
  for (const ex of query.excludes) {
    if (normalize(post.content).includes(normalize(ex))) {
      return { score: 0, reasons: ['除外語含む'], fieldHits: { content: 0, tags: 0, phrase: 0 } };
    }
    if (post.tag_names.some((t) => normalize(t).includes(normalize(ex)))) {
      return { score: 0, reasons: ['除外タグ含む'], fieldHits: { content: 0, tags: 0, phrase: 0 } };
    }
  }

  // ブロックタグを含む投稿は除外
  if (post.tag_names.some((t) => ctx.blockedTags.has(t))) {
    return { score: 0, reasons: ['ブロックタグ'], fieldHits: { content: 0, tags: 0, phrase: 0 } };
  }

  // フィルタ: hasMedia
  if (query.hasMedia && (!post.media_urls || post.media_urls.length === 0)) {
    return { score: 0, reasons: ['画像なし除外'], fieldHits: { content: 0, tags: 0, phrase: 0 } };
  }
  if (query.hasLink && !post.source_url) {
    return { score: 0, reasons: ['出典なし除外'], fieldHits: { content: 0, tags: 0, phrase: 0 } };
  }
  // 日付
  const postDate = new Date(post.created_at);
  if (query.before && postDate >= query.before) return { score: 0, reasons: ['日付範囲外'], fieldHits: { content: 0, tags: 0, phrase: 0 } };
  if (query.after && postDate < query.after) return { score: 0, reasons: ['日付範囲外'], fieldHits: { content: 0, tags: 0, phrase: 0 } };
  // スコア
  if (query.minScore !== undefined && post.trust_score_at_post < query.minScore) return { score: 0, reasons: ['信頼スコア範囲外'], fieldHits: { content: 0, tags: 0, phrase: 0 } };
  if (query.maxScore !== undefined && post.trust_score_at_post > query.maxScore) return { score: 0, reasons: ['信頼スコア範囲外'], fieldHits: { content: 0, tags: 0, phrase: 0 } };
  // kind
  if (query.kinds.length > 0 && (!post.kind || !query.kinds.includes(post.kind))) {
    return { score: 0, reasons: ['種類フィルタ'], fieldHits: { content: 0, tags: 0, phrase: 0 } };
  }
  // tag 必須
  for (const reqTag of query.tags) {
    if (!post.tag_names.some((t) => normalize(t) === normalize(reqTag))) {
      return { score: 0, reasons: ['必須タグなし'], fieldHits: { content: 0, tags: 0, phrase: 0 } };
    }
  }

  // ---- BM25: フレーズスコア (重み 5) ----
  for (const phrase of phrases) {
    const s = bm25Field(phrase, post.content, 5);
    if (s > 0) { phraseHits += s; total += s; reasons.push(`"${phrase}"`); }
    // tag にも完全一致
    const tagJoined = post.tag_names.join(' ');
    const ts = bm25Field(phrase, tagJoined, 6);
    if (ts > 0) { phraseHits += ts; total += ts; }
  }

  // ---- BM25: キーワード ----
  for (const kw of terms) {
    // 本文 (重み 1)
    const c = bm25Field(kw, post.content, 1);
    if (c > 0) { contentHits += c; total += c; }
    // タグ (重み 3)
    for (const tag of post.tag_names) {
      const t = bm25Field(kw, tag, 3);
      if (t > 0) { tagHits += t; total += t; }
      // 完全一致タグ
      if (normalize(tag) === normalize(kw)) {
        total += 3;
        tagHits += 3;
        reasons.push(`#${tag}`);
      }
    }
  }

  // 必須タグマッチ (tag:オペレータ) は強い加点
  for (const reqTag of query.tags) {
    if (post.tag_names.some((t) => normalize(t) === normalize(reqTag))) {
      total += 5;
      reasons.push(`#${reqTag}`);
    }
  }

  // 拡張タグ (タググラフ由来) のマッチ
  for (const tag of post.tag_names) {
    if (expandedTags.has(tag) && !query.tags.includes(tag)) {
      total += 1.5;
      reasons.push(`関連#${tag}`);
    }
  }

  // === シグナル ===
  // 人気度: log(likes + 2*comments)
  const engagement = Math.log(1 + post.likes_count + post.comments_count * 2);
  total += engagement * 0.3;

  // 新鮮度: 24h で半減する指数減衰
  const ageHours = (Date.now() - postDate.getTime()) / 3600000;
  const freshness = 3 * Math.exp(-ageHours / 72); // 3日で 1/e
  total += freshness;
  if (ageHours < 24) reasons.push('新着');

  // 信頼スコア: 70 で base, 100 で +2, 30 で -2
  const trustBoost = (post.trust_score_at_post - 50) * 0.04;
  total += trustBoost;
  if (post.trust_score_at_post >= 80) reasons.push('高信頼');

  // 警告: concern > likes
  if (post.concern_count > post.likes_count + 2) total *= 0.4;

  // === パーソナライゼーション ===
  // 好きなタグを含む投稿は加点
  let likedHit = 0;
  for (const tag of post.tag_names) {
    if (ctx.likedTags.has(tag)) likedHit++;
  }
  if (likedHit > 0) {
    total += likedHit * 1.5;
    reasons.push('❤あなたの推し');
  }

  // クリック履歴ベース: ユーザーがよく見るタグの投稿を加点
  let affinityScore = 0;
  for (const tag of post.tag_names) {
    affinityScore += ctx.tagAffinity[tag] ?? 0;
  }
  if (affinityScore > 0) {
    total += Math.min(affinityScore * 0.8, 3);
    if (affinityScore > 1) reasons.push('👀よく見る');
  }

  // 直近で閲覧したタグの投稿はさらに加点
  let recentHit = 0;
  for (const tag of post.tag_names) {
    if (ctx.recentTags.includes(tag)) recentHit++;
  }
  if (recentHit > 0) {
    total += recentHit * 0.5;
  }

  return {
    score: Math.max(0, total),
    reasons: [...new Set(reasons)].slice(0, 4),
    fieldHits: { content: contentHits, tags: tagHits, phrase: phraseHits },
  };
}

export type TagDoc = { name: string; post_count: number; member_count: number };

export function scoreTagItem(
  tag: TagDoc,
  query: ParsedQuery,
  expandedTags: Set<string>,
  ctx: PersonalizationCtx,
): ScoreInfo {
  let total = 0;
  const reasons: string[] = [];
  if (ctx.blockedTags.has(tag.name)) return { score: 0, reasons: ['ブロック'], fieldHits: { content: 0, tags: 0, phrase: 0 } };

  const terms = [...query.keywords, ...query.phrases];
  for (const kw of terms) {
    const s = bm25Field(kw, tag.name, 10);
    if (s > 0) { total += s; }
    if (normalize(tag.name) === normalize(kw)) { total += 30; reasons.push('完全一致'); }
  }
  if (expandedTags.has(tag.name)) { total += 8; reasons.push('連携'); }
  if (ctx.likedTags.has(tag.name)) { total += 12; reasons.push('❤'); }
  // クリック履歴ベース
  const affinity = ctx.tagAffinity[tag.name] ?? 0;
  if (affinity > 0) { total += affinity * 2; reasons.push('👀'); }
  total += Math.log(1 + tag.member_count) * 0.7;
  total += Math.log(1 + tag.post_count) * 0.5;
  return { score: total, reasons, fieldHits: { content: 0, tags: 0, phrase: 0 } };
}

// マッチ部分のハイライト用: テキスト内の用語位置を返す
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
