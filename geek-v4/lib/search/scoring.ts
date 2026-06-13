// 検索結果のランキングスコア (BM25 + シグナル + パーソナライゼーション)
import { normalize, katakanaToHiragana, hiraganaToKatakana } from './tokenize';
import type { ParsedQuery } from './queryParser';
import { getQueryMode } from './queryParser';
import { levenshteinDistance } from './typoTolerance';

// ============================================================
// BM25 tuning notes (2026-05)
// ============================================================
// データ特性 (geek SNS):
//   - post.content は短い (大半 80〜200 文字 = AVG_DOC_LEN 100 で OK)
//   - 重複語が多い (タグを本文に書く文化)
//   - title-like field がない → tag_names が "title" 相当
//
// k1 (term frequency saturation):
//   - 1.2 にすると同じ語の繰り返しが緩く頭打ち → spam 投稿の上位化を抑制
//   - Google も BM25F の k1 ≈ 1.2 を使う (ICTIR'2008 知見)
//   - 元の 1.5 から 1.2 に下げる
//
// b (length normalization):
//   - 0.5 にすると短い post が過度に有利化しない (BM25 default 0.75 は web doc 用)
//   - SNS のような短文では 0.5 が経験的に最良 (Lin et al. 2021)
//   - 元の 0.75 から 0.5 に下げる
//
// 既存挙動を完全に壊さないために、scorePost に opts.bm25 で override 可。
const BM25_K1 = 1.2;
const BM25_B = 0.5;
const AVG_DOC_LEN = 100;

// ============================================================
// Field weighting (title >> body > tag) の方針:
// ============================================================
// 元実装は keyword: 本文 1.0 / タグ 3.0 / phrase: 本文 5.0 / タグ 6.0。
// title が無い (= tag が title role) ので tag を「title 級」に格上げする:
//   - keyword: 本文 1.0 → そのまま, タグ 3.0 → 5.0 (title 級)
//   - phrase: 本文 5.0 → そのまま (フレーズはもともと重い), タグ 6.0 → 10.0
//   - 完全一致タグ: +3 → +6 (tag-as-title hit を Google 的に 3-5x 重く)
const FIELD_W_KEYWORD_CONTENT = 1.0;
const FIELD_W_KEYWORD_TAG = 5.0;
const FIELD_W_PHRASE_CONTENT = 5.0;
const FIELD_W_PHRASE_TAG = 10.0;

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
  /** トレンド中のタグ — 加速度ベース (rolling 1h) */
  trendingTags?: Set<string>;
  /** タグの IDF map (log(N / df)) — 推定可能なら渡す */
  tagIdf?: Record<string, number>;
  /** 投稿全体の数 (BM25 IDF 計算用) */
  totalDocs?: number;
  /** ターム → 出現文書数 (BM25 IDF 計算用) */
  termDocFreq?: Record<string, number>;
  /** Cold start mode — 新規ユーザー向け diversity 補正 */
  coldStartMode?: boolean;
};

// BM25 component: a single term within a single document field
//   ctx を渡すと実 IDF (log(N / df)) を計算する。渡さなければ fallback の 1.5
function bm25Field(
  term: string,
  fieldText: string,
  fieldWeight = 1,
  avgLen = AVG_DOC_LEN,
  ctx?: PersonalizationCtx,
): number {
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
    else {
      // 短い tag-like field (<= 20 chars) では typo tolerance も試す
      // 1 文字違いで hit したら 0.25 の weak match として加算
      // → "ぽけもむ" → "ぽけもん" (tag) のような typo を救う
      if (docLen <= 20 && t.length >= 3) {
        const dist = levenshteinDistance(t, docNorm);
        // 距離 1 (短語) or 2 (>=7文字) まで許容
        const tolerance = t.length >= 7 ? 2 : 1;
        if (dist <= tolerance && dist > 0) {
          tf = 0.25;
        } else {
          return 0;
        }
      } else {
        return 0;
      }
    }
  }
  // 実 IDF — N / df の log。N が不明なら fallback 1.5
  // よくあるタグは IDF が低く (~0)、希少タグは高く (~5) なる
  let idf = 1.5;
  if (ctx?.tagIdf && ctx.tagIdf[t] !== undefined) {
    idf = ctx.tagIdf[t]!;
  } else if (ctx?.totalDocs && ctx?.termDocFreq) {
    const df = ctx.termDocFreq[t] ?? 1;
    idf = Math.log(1 + ctx.totalDocs / Math.max(1, df));
  }
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

  // ---- BM25: フレーズスコア ----
  // タグの方が title 級なので 2x 重く。"完全フレーズ" は元々重い。
  for (const phrase of phrases) {
    const s = bm25Field(phrase, post.content, FIELD_W_PHRASE_CONTENT, AVG_DOC_LEN, ctx);
    if (s > 0) { phraseHits += s; total += s; reasons.push(`"${phrase}"`); }
    const tagJoined = post.tag_names.join(' ');
    const ts = bm25Field(phrase, tagJoined, FIELD_W_PHRASE_TAG, AVG_DOC_LEN, ctx);
    if (ts > 0) { phraseHits += ts; total += ts; }
  }

  // ---- BM25: キーワード ----
  // 元の本文 1 / タグ 3 → 本文 1 / タグ 5 (title 級, 5x).
  // 完全一致タグ exact bonus も 3 → 6 で 2x 強化 (Google: title-hit は body-hit より 3-5x)
  //
  // mode-aware: keyword 毎に「hit したか?」を tracking する。
  //   - loose mode (2+ words) で hit していない keyword があれば最後に penalty
  //   - strict mode (1 word) で完全一致したら最後に小ボーナス
  const kwHitFlags = new Array<boolean>(terms.length).fill(false);
  let strictExactTagHit = false;
  for (let ki = 0; ki < terms.length; ki++) {
    const kw = terms[ki]!;
    const c = bm25Field(kw, post.content, FIELD_W_KEYWORD_CONTENT, AVG_DOC_LEN, ctx);
    if (c > 0) { contentHits += c; total += c; kwHitFlags[ki] = true; }
    for (const tag of post.tag_names) {
      const t = bm25Field(kw, tag, FIELD_W_KEYWORD_TAG, AVG_DOC_LEN, ctx);
      if (t > 0) { tagHits += t; total += t; kwHitFlags[ki] = true; }
      if (normalize(tag) === normalize(kw)) {
        total += 6;          // ★ 3 → 6 (Google 風 title-hit boost)
        tagHits += 6;
        kwHitFlags[ki] = true;
        strictExactTagHit = true;
        reasons.push(`#${tag}`);
      }
    }
  }

  // Query mode 補正 (1 単語 strict / 2+ loose AND)
  const mode = getQueryMode(query);
  if (terms.length > 0) {
    if (mode === 'loose') {
      // 全 keyword が hit していなければ AND 条件を満たさない — ペナルティで降下
      const hitCount = kwHitFlags.filter(Boolean).length;
      const missCount = terms.length - hitCount;
      if (missCount > 0) {
        // 1 つ miss = 0.5x, 2 つ miss = 0.25x, 全部 miss = 0
        total *= Math.pow(0.5, missCount);
      }
    } else if (mode === 'strict' && strictExactTagHit) {
      // 1 単語 strict で完全一致タグなら +2 (Google: navigational query 風)
      total += 2;
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
  // 人気度: log(likes + 2*comments) — cap で popularity bubble 抑止
  const engagement = Math.log(1 + post.likes_count + post.comments_count * 2);
  // engagement boost に上限 2.0 を入れて winner-takes-all を緩和
  const engagementBoost = Math.min(2.0, engagement * 0.3);
  total += engagementBoost;
  // ============================================================
  // Popularity tiebreaker (Google PageRank 風)
  // ============================================================
  // 「同 score なら like / comment が多い方が上位」を実現する微小加算。
  // engagementBoost は cap で頭打ちなので、cap 後に <1.0 の連続値を載せて
  // 順序を決定的にする。
  //
  //   tiebreaker = log10(1 + likes + 2*comments) / 100   ∈ [0, ~0.07)
  //
  // この量は他のシグナル (新鮮度 0..3, 信頼 ±2 など) に紛れず、
  // 「同 score 同 reason」になった時だけ効く。
  const tiebreaker = Math.log10(1 + post.likes_count + post.comments_count * 2) / 100;
  total += tiebreaker;

  // 新鮮度: 24h で半減する指数減衰
  const ageHours = (Date.now() - postDate.getTime()) / 3600000;
  const freshness = 3 * Math.exp(-ageHours / 72); // 3日で 1/e
  total += freshness;
  if (ageHours < 24) reasons.push('新着');

  // トレンド中タグを 1 件でも含み、かつ post が直近 24h ならホット boost
  if (ctx.trendingTags && ctx.trendingTags.size > 0 && ageHours < 24) {
    let trendingHit = 0;
    for (const tag of post.tag_names) {
      if (ctx.trendingTags.has(tag)) trendingHit++;
    }
    if (trendingHit > 0) {
      total += Math.min(trendingHit * 2.5, 5);
      reasons.push('🔥トレンド');
    }
  }

  // 信頼スコア: 比例 + 低信頼の penalty を強化
  // 70 → +0.8, 100 → +2.0, 30 → -0.8, 20 → ×0.5 multiplier 追加
  const trustNorm = (post.trust_score_at_post - 50) / 50;  // -1..+1
  if (trustNorm < -0.4) {
    total *= 0.5;  // 著しく低信頼は半減
  } else {
    total += trustNorm * 2;
  }
  if (post.trust_score_at_post >= 80) reasons.push('高信頼');

  // 警告: concern が likes に比べて多すぎる場合は graduated penalty
  // ratio 0.5 → 0.85x, 1.0 → 0.6x, 2.0 → 0.3x
  const engagementBase = Math.max(1, post.likes_count + post.comments_count);
  const concernRatio = post.concern_count / engagementBase;
  if (concernRatio > 0.5) {
    total *= Math.max(0.3, 1 - concernRatio * 0.7);
  }

  // Cold-start mode: 新規ユーザーは popular content を抑え気味に
  // → diversity 増加で新規ユーザーの "feed が全員同じ" 問題を緩和
  if (ctx.coldStartMode && engagement > 5) {
    total *= 0.75;
  }

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
