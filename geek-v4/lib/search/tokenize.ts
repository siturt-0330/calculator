// 日本語対応トークナイザー
// - 全角→半角
// - 大文字小文字統一
// - カタカナ↔ひらがな
// - 単語分割 + 2-gram 生成
// - 不要な記号除去

export type Token = { text: string; type: 'word' | 'ngram' };

const FULLWIDTH_REGEX = /[！-～]/g;
const KATAKANA_REGEX = /[ァ-ヶ]/g;
// 半角カタカナ (U+FF61-U+FF9F)
const HALFWIDTH_KATA_REGEX = /[｡-ﾟ]/g;
// 半角カナ → 全角カナ map (濁点 / 半濁点も合成)
const HW_KATA_MAP: Record<string, string> = {
  '｡': '。', '｢': '「', '｣': '」', '､': '、', '･': '・',
  'ｦ': 'ヲ', 'ｧ': 'ァ', 'ｨ': 'ィ', 'ｩ': 'ゥ', 'ｪ': 'ェ', 'ｫ': 'ォ',
  'ｬ': 'ャ', 'ｭ': 'ュ', 'ｮ': 'ョ', 'ｯ': 'ッ',
  'ｰ': 'ー',
  'ｱ': 'ア', 'ｲ': 'イ', 'ｳ': 'ウ', 'ｴ': 'エ', 'ｵ': 'オ',
  'ｶ': 'カ', 'ｷ': 'キ', 'ｸ': 'ク', 'ｹ': 'ケ', 'ｺ': 'コ',
  'ｻ': 'サ', 'ｼ': 'シ', 'ｽ': 'ス', 'ｾ': 'セ', 'ｿ': 'ソ',
  'ﾀ': 'タ', 'ﾁ': 'チ', 'ﾂ': 'ツ', 'ﾃ': 'テ', 'ﾄ': 'ト',
  'ﾅ': 'ナ', 'ﾆ': 'ニ', 'ﾇ': 'ヌ', 'ﾈ': 'ネ', 'ﾉ': 'ノ',
  'ﾊ': 'ハ', 'ﾋ': 'ヒ', 'ﾌ': 'フ', 'ﾍ': 'ヘ', 'ﾎ': 'ホ',
  'ﾏ': 'マ', 'ﾐ': 'ミ', 'ﾑ': 'ム', 'ﾒ': 'メ', 'ﾓ': 'モ',
  'ﾔ': 'ヤ', 'ﾕ': 'ユ', 'ﾖ': 'ヨ',
  'ﾗ': 'ラ', 'ﾘ': 'リ', 'ﾙ': 'ル', 'ﾚ': 'レ', 'ﾛ': 'ロ',
  'ﾜ': 'ワ', 'ﾝ': 'ン',
};

// 全角英数字 → 半角
export function fullToHalf(s: string): string {
  // 先に半角カナを全角カナへ正規化 (ﾎﾛﾗｲﾌﾞ → ホロライブ)
  let out = s.replace(HALFWIDTH_KATA_REGEX, (ch) => HW_KATA_MAP[ch] ?? ch);
  // 続いて濁点・半濁点を直前文字に合成 (例: ｶﾞ → ガ)
  out = out
    .replace(/([カキクケコサシスセソタチツテトハヒフヘホ])ﾞ/g, (_, c) =>
      String.fromCharCode(c.charCodeAt(0) + 1),
    )
    .replace(/([ハヒフヘホ])ﾟ/g, (_, c) => String.fromCharCode(c.charCodeAt(0) + 2));
  // 既存の全角英数 → 半角変換
  return out.replace(FULLWIDTH_REGEX, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
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

// 長音符 / 小書きかな の正規化 (recall を上げるため検索時のみ適用)
// らーめん / らあめん / らぁめん → 同一トークンとして扱う
const LONG_VOWEL_NORMALIZE: Record<string, string> = {
  'ー': '',  // 長音符は削除
  'ぁ': 'あ', 'ぃ': 'い', 'ぅ': 'う', 'ぇ': 'え', 'ぉ': 'お',
  'ゃ': 'や', 'ゅ': 'ゆ', 'ょ': 'よ',
  'ァ': 'ア', 'ィ': 'イ', 'ゥ': 'ウ', 'ェ': 'エ', 'ォ': 'オ',
  'ャ': 'ヤ', 'ュ': 'ユ', 'ョ': 'ヨ',
  'っ': 'つ', 'ッ': 'ツ',  // 促音は通常文字へ
};
const LONG_VOWEL_REGEX = /[ーぁぃぅぇぉゃゅょァィゥェォャュョっッ]/g;
export function normalizeLongVowels(s: string): string {
  return s.replace(LONG_VOWEL_REGEX, (ch) => LONG_VOWEL_NORMALIZE[ch] ?? ch);
}

// 正規化: 検索しやすい形に
export function normalize(s: string): string {
  return fullToHalf(s).toLowerCase().trim();
}

// 深い正規化: 検索 recall を最大化する用途
// 1) 通常 normalize に長音符 / 小書きかなを base 母音へ
// 2) カタカナ → ひらがな統一
// これで「らーめん」「らあめん」「ラーメン」「ラァメン」が同一トークン化
export function deepNormalize(s: string): string {
  return katakanaToHiragana(normalizeLongVowels(normalize(s)));
}

// 単語境界で分割 (空白・句読点・括弧・記号)
const WORD_BOUNDARY = /[\s,.、。!?！？「」『』()（）[\]/\\#&|]+/;

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
