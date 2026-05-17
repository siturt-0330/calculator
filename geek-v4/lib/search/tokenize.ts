// 日本語対応トークナイザー
// - 全角→半角
// - 大文字小文字統一
// - カタカナ↔ひらがな
// - 単語分割 + 2-gram 生成
// - 不要な記号除去

export type Token = { text: string; type: 'word' | 'ngram' };

const FULLWIDTH_REGEX = /[！-～]/g;
const KATAKANA_REGEX = /[ァ-ヶ]/g;

// 全角英数字 → 半角
export function fullToHalf(s: string): string {
  return s.replace(FULLWIDTH_REGEX, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

// 半角英数字 → 全角
export function halfToFull(s: string): string {
  return s.replace(/[!-~]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0xfee0));
}

// カタカナ → ひらがな (検索のゆらぎ吸収)
export function katakanaToHiragana(s: string): string {
  return s.replace(KATAKANA_REGEX, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

// ひらがな → カタカナ
export function hiraganaToKatakana(s: string): string {
  return s.replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
}

// 正規化: 検索しやすい形に
export function normalize(s: string): string {
  return fullToHalf(s).toLowerCase().trim();
}

// 単語境界で分割 (空白・句読点・括弧・記号)
const WORD_BOUNDARY = /[\s　,.、。!?！？「」『』()（）\[\]\/\\#&|]+/;

export function splitWords(s: string): string[] {
  return normalize(s).split(WORD_BOUNDARY).filter((w) => w.length > 0);
}

// n-gram 生成 (日本語の検索精度向上)
export function ngrams(s: string, n = 2): string[] {
  const norm = normalize(s);
  if (norm.length < n) return [norm];
  const out: string[] = [];
  for (let i = 0; i <= norm.length - n; i++) {
    out.push(norm.slice(i, i + n));
  }
  return out;
}

// クエリ全体をトークン化 (語 + 2-gram の和)
export function tokenize(s: string): string[] {
  const words = splitWords(s);
  const tokens = new Set<string>();
  for (const w of words) {
    tokens.add(w);
    if (w.length >= 2) {
      for (const g of ngrams(w, 2)) tokens.add(g);
    }
  }
  return [...tokens];
}

// クエリのゆらぎ変換 (カタカナ/ひらがな両方)
export function expandReadings(query: string): string[] {
  const norm = normalize(query);
  const variants = new Set<string>([norm]);
  variants.add(katakanaToHiragana(norm));
  variants.add(hiraganaToKatakana(norm));
  return [...variants].filter((v) => v.length > 0);
}

// 日本語の検索で除外したい助詞・記号など (search に意味を持たない短い文字)
const STOPWORDS = new Set([
  'の', 'を', 'に', 'は', 'が', 'と', 'で', 'も', 'や', 'へ', 'から', 'まで', 'より',
  'a', 'an', 'the', 'is', 'are', 'and', 'or', 'of', 'in', 'on', 'to', 'for',
]);

export function isStopword(s: string): boolean {
  return STOPWORDS.has(s.toLowerCase());
}

export function removeStopwords(words: string[]): string[] {
  return words.filter((w) => !isStopword(w));
}

// 検索クエリを検索しやすい形に: 単語 + 読みゆらぎ + ngram + stopword除去
export function buildSearchTokens(query: string): string[] {
  const words = removeStopwords(splitWords(query));
  const tokens = new Set<string>();
  for (const w of words) {
    if (w.length < 1) continue;
    tokens.add(w);
    // カタカナ ↔ ひらがな
    const ka = hiraganaToKatakana(w);
    const hi = katakanaToHiragana(w);
    if (ka !== w) tokens.add(ka);
    if (hi !== w) tokens.add(hi);
    // 短すぎる時のみ 2-gram
    if (w.length >= 2 && w.length <= 4) {
      for (const g of ngrams(w, 2)) tokens.add(g);
    }
  }
  return [...tokens];
}
