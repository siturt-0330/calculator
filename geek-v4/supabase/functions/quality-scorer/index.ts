// ============================================================
// quality-scorer: 投稿の品質 / 安全性スコアを計算 (pure compute)
// ============================================================
// 入力: POST { post_id?, title?, content, media_count?, video_count? }
// 出力: { scores: {...7 metrics...}, reasons: string[] }
//
// SQL view (0087 post_quality_score / 0090 post_safety_score) を
// 補完する細粒度の heuristic 評価層。
//
// 設計:
//   - DB access なし (SUPABASE_SERVICE_ROLE_KEY 不要)
//   - POST のみ受ける、GET / その他 method は 405
//   - CORS allowlist (_shared/cors.ts)
//   - TypeScript strict / any 禁止
//   - 失敗時は 5xx + reasons:[] (fail-open: 完全 0 スコアは返さない)
//
// 重み付け (composite_quality 計算):
//   length_appropriate  * 0.20
//   readability         * 0.20
//   media_richness      * 0.20
//   link_health         * 0.20
//   (1 - clickbait)     * 0.10
//   (1 - spam)          * 0.10
//   ----------------------------- = 1.00
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { buildCorsHeaders, jsonResponse } from '../_shared/cors.ts';

// ============================================================
// 定数
// ============================================================

const MAX_CONTENT_LEN = 20_000;
const MAX_TITLE_LEN = 300;

// length スコアの理想ゾーン (文字数)。
// 短すぎ (< 30) も長すぎ (> 3000) もペナルティ。
const LEN_MIN_OK = 30;
const LEN_SWEET_MIN = 120;
const LEN_SWEET_MAX = 1500;
const LEN_MAX_OK = 3000;

// 重み付け
const W_LENGTH = 0.2;
const W_READABILITY = 0.2;
const W_MEDIA = 0.2;
const W_LINK = 0.2;
const W_CLICKBAIT_INV = 0.1;
const W_SPAM_INV = 0.1;

// clickbait keyword (日本語 + 英語、約 30 語)
const CLICKBAIT_KEYWORDS: readonly string[] = [
  // 日本語
  '衝撃',
  'マジで',
  '神',
  '絶対',
  '驚愕',
  'ヤバ',
  'やば',
  'ガチ',
  '100%',
  'やばすぎ',
  '必見',
  '完全保存版',
  '裏技',
  '禁断',
  '炎上',
  '激ヤバ',
  '誰も知らない',
  // 英語
  'shocking',
  'unbelievable',
  'you wont believe',
  'must see',
  'incredible',
  'mind blowing',
  'insane',
  'breaking',
  'secret',
  'banned',
  'exposed',
  'gone wrong',
  'gone viral',
];

// spam keyword
const SPAM_KEYWORDS: readonly string[] = [
  '稼げる',
  '簡単に',
  '無料配布',
  '今すぐ登録',
  'クリック',
  'DM下さい',
  '副業',
  '高収入',
  '当選',
  '限定',
  'プレゼント企画',
  'follow back',
  'click here',
  'free money',
  'earn $',
  'work from home',
  'crypto airdrop',
  'pump',
];

// 短縮 URL ドメイン (リンクの可視性低下 + spam に多い)
const SHORTENER_HOSTS: readonly string[] = [
  'bit.ly',
  't.co',
  'tinyurl.com',
  'goo.gl',
  'ow.ly',
  'is.gd',
  'buff.ly',
  'lnkd.in',
  'rb.gy',
  'cutt.ly',
  'shorturl.at',
];

// ホワイトリスト (信頼度高めのホスト)
const WHITELIST_HOSTS: readonly string[] = [
  'github.com',
  'gitlab.com',
  'wikipedia.org',
  'wikimedia.org',
  'youtube.com',
  'youtu.be',
  'twitter.com',
  'x.com',
  'note.com',
  'qiita.com',
  'zenn.dev',
  'stackoverflow.com',
  'mdn.io',
  'developer.mozilla.org',
];

// 怪しい TLD / フリー hosting
const BLACKLIST_HOST_PATTERNS: readonly RegExp[] = [
  /\.tk$/i,
  /\.top$/i,
  /\.click$/i,
  /\.xyz$/i,
  /\.work$/i,
  /\.cf$/i,
  /\.ga$/i,
  /\.ml$/i,
];

// URL 抽出 (粗いが pure heuristic としては十分)
const URL_RE = /https?:\/\/[^\s)<>"'、。「」『』]+/giu;

// mention / hashtag
const MENTION_RE = /@[A-Za-z0-9_]{2,30}/g;
const HASHTAG_RE = /#[\p{L}\p{N}_]{1,30}/gu;

// 文末記号 (日本語 + 英語)
const SENTENCE_SPLIT_RE = /[。．.!?！？\n]+/u;

// ============================================================
// 型定義
// ============================================================

type ScorerInput = {
  postId: string | null;
  title: string;
  content: string;
  mediaCount: number;
  videoCount: number;
};

type Scores = {
  length_appropriate: number;
  readability: number;
  media_richness: number;
  link_health: number;
  clickbait_likelihood: number;
  spam_likelihood: number;
  composite_quality: number;
};

type ScorerOutput = {
  scores: Scores;
  reasons: string[];
};

// ============================================================
// 入力 sanitize
// ============================================================

function parseInput(raw: unknown): ScorerInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const content = typeof obj.content === 'string' ? obj.content : null;
  if (content === null) return null;
  if (content.length > MAX_CONTENT_LEN) return null;

  const title = typeof obj.title === 'string' ? obj.title.slice(0, MAX_TITLE_LEN) : '';
  const postId =
    typeof obj.post_id === 'string' && obj.post_id.length > 0 && obj.post_id.length <= 64
      ? obj.post_id
      : null;
  const mediaCount = sanitizeCount(obj.media_count);
  const videoCount = sanitizeCount(obj.video_count);

  return { postId, title, content, mediaCount, videoCount };
}

function sanitizeCount(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return 0;
  // 異常値を弾く (DoS / nonsense 入力)
  return Math.min(Math.floor(v), 100);
}

// ============================================================
// utility
// ============================================================

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function stdev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((a, b) => a + (b - mean) * (b - mean), 0) / arr.length;
  return Math.sqrt(variance);
}

function countMatches(text: string, re: RegExp): number {
  const m = text.match(re);
  return m ? m.length : 0;
}

function lowerNFKC(s: string): string {
  return s.normalize('NFKC').toLowerCase();
}

function hostnameOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

// ============================================================
// 1. length_appropriate
// ============================================================
// 30 字未満 = 低スコア、120〜1500 が sweet zone、3000 超で低下
function scoreLengthAppropriate(content: string): { score: number; len: number } {
  const len = content.replace(/\s/g, '').length; // 空白除いた実長
  if (len === 0) return { score: 0, len };
  if (len < LEN_MIN_OK) {
    return { score: clamp01(len / LEN_MIN_OK * 0.5), len };
  }
  if (len < LEN_SWEET_MIN) {
    // LEN_MIN_OK → LEN_SWEET_MIN を 0.5 → 1.0 線形補間
    const t = (len - LEN_MIN_OK) / (LEN_SWEET_MIN - LEN_MIN_OK);
    return { score: 0.5 + 0.5 * t, len };
  }
  if (len <= LEN_SWEET_MAX) {
    return { score: 1.0, len };
  }
  if (len <= LEN_MAX_OK) {
    // LEN_SWEET_MAX → LEN_MAX_OK を 1.0 → 0.5 線形補間
    const t = (len - LEN_SWEET_MAX) / (LEN_MAX_OK - LEN_SWEET_MAX);
    return { score: 1.0 - 0.5 * t, len };
  }
  return { score: 0.3, len };
}

// ============================================================
// 2. readability
// ============================================================
// 文の長さの標準偏差 + 句読点比率を組み合わせる
function scoreReadability(content: string): { score: number; sentenceCount: number } {
  const sentences = content
    .split(SENTENCE_SPLIT_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (sentences.length === 0) return { score: 0, sentenceCount: 0 };
  if (sentences.length === 1 && sentences[0]!.length < 20) {
    // 1 文しかなく短い → 評価不能なので中程度
    return { score: 0.5, sentenceCount: 1 };
  }

  const lengths = sentences.map((s) => s.length);
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const sd = stdev(lengths);

  // 標準偏差は平均に対して 0.4〜0.8 倍くらいが「リズムある」目安
  const cv = mean > 0 ? sd / mean : 0;
  const rhythmScore =
    cv < 0.2 ? 0.5 : cv > 1.5 ? 0.3 : cv > 0.8 ? 0.7 : 1.0; // ざっくり

  // 句読点比率 (1 文字あたり 0.02〜0.10 が読みやすい目安)
  const punctCount = countMatches(content, /[、。,.!?！？；;:：]/gu);
  const punctRatio = content.length > 0 ? punctCount / content.length : 0;
  let punctScore: number;
  if (punctRatio < 0.005) punctScore = 0.4; // 句読点ほぼ無し
  else if (punctRatio > 0.2) punctScore = 0.3; // 句読点過多
  else if (punctRatio < 0.02) punctScore = 0.7;
  else punctScore = 1.0;

  // 極端に長い 1 文 (200 字超) があれば減点
  const tooLong = lengths.filter((l) => l > 200).length;
  const longPenalty = tooLong > 0 ? Math.min(0.3, tooLong * 0.1) : 0;

  const combined = clamp01(rhythmScore * 0.6 + punctScore * 0.4 - longPenalty);
  return { score: combined, sentenceCount: sentences.length };
}

// ============================================================
// 3. media_richness
// ============================================================
// log scale: 0 件 = 0, 1 件 = 0.5, 2 件 = 0.7, 3 件 = 0.8, 4+ = 0.9〜1.0
// video は 1 件 = image 2 件相当
function scoreMediaRichness(mediaCount: number, videoCount: number): number {
  const effective = mediaCount + videoCount * 2;
  if (effective <= 0) return 0;
  // log2(1+x) / log2(1+8) を base に
  const norm = Math.log2(1 + effective) / Math.log2(1 + 8);
  return clamp01(norm);
}

// ============================================================
// 4. link_health  (高いほど良い)
// ============================================================
function scoreLinkHealth(
  content: string,
): { score: number; urlCount: number; shortenerCount: number; suspiciousCount: number } {
  const urls = content.match(URL_RE) ?? [];
  const urlCount = urls.length;
  if (urlCount === 0) return { score: 1, urlCount: 0, shortenerCount: 0, suspiciousCount: 0 };

  let shortenerCount = 0;
  let suspiciousCount = 0;
  let whitelistCount = 0;

  for (const u of urls) {
    const host = hostnameOf(u);
    if (host === null) {
      suspiciousCount += 1;
      continue;
    }
    if (SHORTENER_HOSTS.some((h) => host === h || host.endsWith('.' + h))) {
      shortenerCount += 1;
      continue;
    }
    if (BLACKLIST_HOST_PATTERNS.some((re) => re.test(host))) {
      suspiciousCount += 1;
      continue;
    }
    if (WHITELIST_HOSTS.some((h) => host === h || host.endsWith('.' + h))) {
      whitelistCount += 1;
    }
  }

  // 多すぎる URL は減点 (5 件超でペナルティ)
  let score = 1.0;
  if (urlCount > 5) score -= Math.min(0.4, (urlCount - 5) * 0.05);
  score -= shortenerCount * 0.15;
  score -= suspiciousCount * 0.25;
  // whitelist は微加点
  score += whitelistCount * 0.05;

  return {
    score: clamp01(score),
    urlCount,
    shortenerCount,
    suspiciousCount,
  };
}

// ============================================================
// 5. clickbait_likelihood  (高いほど悪い)
// ============================================================
function scoreClickbait(title: string, content: string): { score: number; hits: string[] } {
  const subject = lowerNFKC(`${title} ${title} ${content}`); // title を 2 倍重み
  const hits: string[] = [];
  for (const kw of CLICKBAIT_KEYWORDS) {
    if (subject.includes(kw.toLowerCase())) hits.push(kw);
  }
  // 「!!!」「???」連発
  const exclam = countMatches(title + content, /[!！]{2,}/g);
  const interro = countMatches(title + content, /[?？]{2,}/g);
  // ALL CAPS 単語 (英語のみ、5 文字以上)
  const caps = countMatches(title, /\b[A-Z]{5,}\b/g);

  let raw = hits.length * 0.15 + exclam * 0.1 + interro * 0.08 + caps * 0.1;
  // title が「衝撃!」のような短い扇情だと加点
  if (title.length > 0 && title.length < 20 && hits.length > 0) raw += 0.1;

  return { score: clamp01(raw), hits };
}

// ============================================================
// 6. spam_likelihood  (高いほど悪い)
// ============================================================
function scoreSpam(
  content: string,
  urlCount: number,
  shortenerCount: number,
): { score: number; hits: string[]; mentionCount: number; hashtagCount: number } {
  const lower = lowerNFKC(content);
  const hits: string[] = [];
  for (const kw of SPAM_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) hits.push(kw);
  }

  const mentionCount = countMatches(content, MENTION_RE);
  const hashtagCount = countMatches(content, HASHTAG_RE);

  let raw = hits.length * 0.18;
  // 短縮 URL 1 件 = +0.3
  raw += shortenerCount * 0.3;
  // URL 6 件超 (短縮以外も含む)
  if (urlCount > 6) raw += 0.2;
  // mention 5 件超
  if (mentionCount > 5) raw += 0.2;
  // hashtag 10 件超
  if (hashtagCount > 10) raw += 0.2;
  // 同一文字 10 連続 (荒らし系)
  if (/(.)\1{9,}/u.test(content)) raw += 0.15;

  return {
    score: clamp01(raw),
    hits,
    mentionCount,
    hashtagCount,
  };
}

// ============================================================
// composite + reasons
// ============================================================

function compositeScore(s: Omit<Scores, 'composite_quality'>): number {
  const v =
    s.length_appropriate * W_LENGTH +
    s.readability * W_READABILITY +
    s.media_richness * W_MEDIA +
    s.link_health * W_LINK +
    (1 - s.clickbait_likelihood) * W_CLICKBAIT_INV +
    (1 - s.spam_likelihood) * W_SPAM_INV;
  return clamp01(v);
}

function buildReasons(args: {
  len: number;
  sentenceCount: number;
  mediaCount: number;
  videoCount: number;
  urlCount: number;
  shortenerCount: number;
  suspiciousCount: number;
  clickbaitHits: string[];
  spamHits: string[];
  mentionCount: number;
  hashtagCount: number;
  scores: Scores;
}): string[] {
  const r: string[] = [];

  // length
  if (args.len < LEN_MIN_OK) {
    r.push(`本文が短すぎます (${args.len} 文字)`);
  } else if (args.len > LEN_MAX_OK) {
    r.push(`本文が長すぎます (${args.len} 文字)`);
  } else if (args.scores.length_appropriate >= 0.9) {
    r.push('本文の長さは適切です');
  }

  // readability
  if (args.scores.readability < 0.5 && args.sentenceCount > 0) {
    r.push('文のリズムまたは句読点バランスが読みづらい可能性');
  }

  // media
  if (args.mediaCount === 0 && args.videoCount === 0) {
    r.push('画像 / 動画が添付されていません');
  } else if (args.scores.media_richness >= 0.7) {
    r.push(
      `メディアが豊富です (画像 ${args.mediaCount} 件 / 動画 ${args.videoCount} 件)`,
    );
  }

  // link
  if (args.urlCount > 5) {
    r.push(`URL が多すぎます (${args.urlCount} 件)`);
  }
  if (args.shortenerCount > 0) {
    r.push(`短縮 URL が含まれています (${args.shortenerCount} 件)`);
  }
  if (args.suspiciousCount > 0) {
    r.push(`怪しいドメインの URL が含まれています (${args.suspiciousCount} 件)`);
  }

  // clickbait
  if (args.clickbaitHits.length > 0) {
    const sample = args.clickbaitHits.slice(0, 3).join('、');
    r.push(
      `扇情的なキーワードを検出 (${sample}${args.clickbaitHits.length > 3 ? ' ほか' : ''})`,
    );
  }

  // spam
  if (args.spamHits.length > 0) {
    const sample = args.spamHits.slice(0, 3).join('、');
    r.push(
      `スパム的なキーワードを検出 (${sample}${args.spamHits.length > 3 ? ' ほか' : ''})`,
    );
  }
  if (args.mentionCount > 5) {
    r.push(`メンションが多すぎます (${args.mentionCount} 件)`);
  }
  if (args.hashtagCount > 10) {
    r.push(`ハッシュタグが多すぎます (${args.hashtagCount} 件)`);
  }

  // composite
  if (args.scores.composite_quality >= 0.8) {
    r.push('総合品質スコアは良好です');
  } else if (args.scores.composite_quality < 0.4) {
    r.push('総合品質スコアが低めです');
  }

  return r;
}

// ============================================================
// メインスコアラ
// ============================================================

function scorePost(input: ScorerInput): ScorerOutput {
  const { title, content, mediaCount, videoCount } = input;

  const lengthRes = scoreLengthAppropriate(content);
  const readabilityRes = scoreReadability(content);
  const mediaRichness = scoreMediaRichness(mediaCount, videoCount);
  const linkRes = scoreLinkHealth(content);
  const clickbaitRes = scoreClickbait(title, content);
  const spamRes = scoreSpam(content, linkRes.urlCount, linkRes.shortenerCount);

  const base = {
    length_appropriate: lengthRes.score,
    readability: readabilityRes.score,
    media_richness: mediaRichness,
    link_health: linkRes.score,
    clickbait_likelihood: clickbaitRes.score,
    spam_likelihood: spamRes.score,
  };

  const scores: Scores = {
    ...base,
    composite_quality: compositeScore(base),
  };

  const reasons = buildReasons({
    len: lengthRes.len,
    sentenceCount: readabilityRes.sentenceCount,
    mediaCount,
    videoCount,
    urlCount: linkRes.urlCount,
    shortenerCount: linkRes.shortenerCount,
    suspiciousCount: linkRes.suspiciousCount,
    clickbaitHits: clickbaitRes.hits,
    spamHits: spamRes.hits,
    mentionCount: spamRes.mentionCount,
    hashtagCount: spamRes.hashtagCount,
    scores,
  });

  return { scores, reasons };
}

// ============================================================
// HTTP handler
// ============================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: buildCorsHeaders(req) });
  }
  if (req.method !== 'POST') {
    return jsonResponse(req, { error: 'method-not-allowed' }, 405);
  }

  try {
    const raw = await req.json().catch(() => null);
    const input = parseInput(raw);
    if (input === null) {
      return jsonResponse(req, { error: 'bad-request' }, 400);
    }

    const out = scorePost(input);
    return jsonResponse(req, out);
  } catch {
    // pure compute なので原則ここには来ないが、保険
    return jsonResponse(req, { error: 'internal' }, 500);
  }
});
