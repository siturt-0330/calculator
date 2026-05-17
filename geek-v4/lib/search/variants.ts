// クエリ多変換エンジン
// "=LOVE" を入れたら以下すべてのバリエーションを生成して検索する:
// - =LOVE (原文)
// - ＝LOVE (全角)
// - =love (小文字)
// - イコラブ (略式読み)
// - イコールラブ (記号読み + 単語)
// - イコール LOVE
// - いこらぶ (ひらがな)
// - ikoraba (ローマ字)
// - ＝ラブ (全角＋カナ)

import {
  normalize, fullToHalf, halfToFull, hiraganaToKatakana, katakanaToHiragana,
} from './tokenize';

// 記号→読み (multiple readings per symbol)
const SYMBOL_READINGS: Record<string, string[]> = {
  '=': ['イコール', 'いこーる', 'イコ', 'いこ', 'equal'],
  '≠': ['ノットイコール', 'ノットイコ', 'のっといこーる', 'notequal'],
  '≒': ['ニアリーイコール', 'ニア', 'にあ', 'にありー', 'nearlyequal'],
  '@': ['アット', 'あっと', 'at'],
  '&': ['アンド', 'あんど', 'and'],
  '+': ['プラス', 'ぷらす', 'plus'],
  '#': ['シャープ', 'ハッシュ', 'しゃーぷ', 'はっしゅ'],
  '$': ['ドル', 'どる', 'dollar'],
  '%': ['パーセント', 'ぱーせんと', 'percent'],
  '*': ['アスタリスク', 'スター', 'すたー', 'star'],
  '★': ['スター', 'すたー', 'star', 'ほし'],
  '☆': ['スター', 'すたー', 'star', 'ほし'],
  '♪': ['オンプ', 'おんぷ', 'おんぷ', 'note'],
  '♥': ['ハート', 'はーと', 'heart'],
  '♡': ['ハート', 'はーと', 'heart'],
  '?': ['ハテナ', 'はてな'],
  '!': ['ビックリ', 'びっくり', 'びくり'],
  '0': ['ゼロ', 'ぜろ', 'zero', '〇', '零'],
  '1': ['いち', 'イチ', 'ワン', 'one', '一', '①'],
  '2': ['に', 'ニ', 'ツー', 'two', '二', '②'],
  '3': ['さん', 'サン', 'スリー', 'three', '三', '③'],
  '4': ['よん', 'し', 'ヨン', 'four', '四', '④'],
  '5': ['ご', 'ゴ', 'ファイブ', 'five', '五', '⑤'],
  '6': ['ろく', 'ロク', 'シックス', 'six', '六', '⑥'],
  '7': ['なな', 'しち', 'ナナ', 'セブン', 'seven', '七', '⑦'],
  '8': ['はち', 'ハチ', 'エイト', 'eight', '八', '⑧'],
  '9': ['きゅう', 'く', 'キュウ', 'ナイン', 'nine', '九', '⑨'],
};

// ローマ字 → ひらがな (主要パターン、長母音/小書き対応)
const ROMAJI_HIRAGANA: [string, string][] = [
  ['kya', 'きゃ'], ['kyu', 'きゅ'], ['kyo', 'きょ'],
  ['sha', 'しゃ'], ['shu', 'しゅ'], ['sho', 'しょ'], ['shi', 'し'],
  ['cha', 'ちゃ'], ['chu', 'ちゅ'], ['cho', 'ちょ'], ['chi', 'ち'], ['tsu', 'つ'],
  ['nya', 'にゃ'], ['nyu', 'にゅ'], ['nyo', 'にょ'],
  ['hya', 'ひゃ'], ['hyu', 'ひゅ'], ['hyo', 'ひょ'],
  ['mya', 'みゃ'], ['myu', 'みゅ'], ['myo', 'みょ'],
  ['rya', 'りゃ'], ['ryu', 'りゅ'], ['ryo', 'りょ'],
  ['gya', 'ぎゃ'], ['gyu', 'ぎゅ'], ['gyo', 'ぎょ'],
  ['ja', 'じゃ'], ['ju', 'じゅ'], ['jo', 'じょ'], ['ji', 'じ'],
  ['bya', 'びゃ'], ['byu', 'びゅ'], ['byo', 'びょ'],
  ['pya', 'ぴゃ'], ['pyu', 'ぴゅ'], ['pyo', 'ぴょ'],
  ['ka', 'か'], ['ki', 'き'], ['ku', 'く'], ['ke', 'け'], ['ko', 'こ'],
  ['sa', 'さ'], ['su', 'す'], ['se', 'せ'], ['so', 'そ'],
  ['ta', 'た'], ['te', 'て'], ['to', 'と'],
  ['na', 'な'], ['ni', 'に'], ['nu', 'ぬ'], ['ne', 'ね'], ['no', 'の'],
  ['ha', 'は'], ['hi', 'ひ'], ['fu', 'ふ'], ['he', 'へ'], ['ho', 'ほ'],
  ['ma', 'ま'], ['mi', 'み'], ['mu', 'む'], ['me', 'め'], ['mo', 'も'],
  ['ya', 'や'], ['yu', 'ゆ'], ['yo', 'よ'],
  ['ra', 'ら'], ['ri', 'り'], ['ru', 'る'], ['re', 'れ'], ['ro', 'ろ'],
  ['wa', 'わ'], ['wo', 'を'], ['nn', 'ん'],
  ['ga', 'が'], ['gi', 'ぎ'], ['gu', 'ぐ'], ['ge', 'げ'], ['go', 'ご'],
  ['za', 'ざ'], ['zu', 'ず'], ['ze', 'ぜ'], ['zo', 'ぞ'],
  ['da', 'だ'], ['de', 'で'], ['do', 'ど'],
  ['ba', 'ば'], ['bi', 'び'], ['bu', 'ぶ'], ['be', 'べ'], ['bo', 'ぼ'],
  ['pa', 'ぱ'], ['pi', 'ぴ'], ['pu', 'ぷ'], ['pe', 'ぺ'], ['po', 'ぽ'],
  ['va', 'ゔぁ'], ['vi', 'ゔぃ'], ['vu', 'ゔ'], ['ve', 'ゔぇ'], ['vo', 'ゔぉ'],
  ['fa', 'ふぁ'], ['fi', 'ふぃ'], ['fe', 'ふぇ'], ['fo', 'ふぉ'],
  ['a', 'あ'], ['i', 'い'], ['u', 'う'], ['e', 'え'], ['o', 'お'],
  ['n', 'ん'],
];

export function romajiToHiragana(s: string): string {
  let result = s.toLowerCase();
  // 長母音記号
  result = result.replace(/(.)\1+/g, (m, ch) => ch + 'ー'.repeat(m.length - 1));
  for (const [r, h] of ROMAJI_HIRAGANA) {
    result = result.replaceAll(r, h);
  }
  return result;
}

// 一般的な略語/同義 (有名アイドル等)
const COMMON_SYNONYMS: Record<string, string[]> = {
  // イコノイジョイ系
  '=LOVE': ['イコラブ', 'いこらぶ', '=ラブ', '＝ラブ', 'イコールラブ', 'ikorabu', 'ikolove'],
  'イコラブ': ['=LOVE', '＝LOVE', '=love', '=ラブ'],
  '≠ME': ['ノイミー', 'のいみー', 'ノットイコールミー', 'notequalme'],
  'ノイミー': ['≠ME', '≠me', 'ノットイコールミー'],
  '≒JOY': ['ニアジョイ', 'にあじょい', 'ニアリーイコールジョイ'],
  'ニアジョイ': ['≒JOY', '≒joy', 'ニアリーイコールジョイ'],
  // KAWAII LAB.
  'FRUITS ZIPPER': ['フルーツジッパー', 'ふるっぱー', 'ふるーつじっぱー'],
  'ふるっぱー': ['FRUITS ZIPPER', 'fruits zipper', 'フルーツジッパー'],
  'CUTIE STREET': ['キューティーストリート', 'きゅーすと', 'きゅーてぃーすとりーと'],
  'きゅーすと': ['CUTIE STREET', 'cutie street'],
  'CANDY TUNE': ['キャンディーチューン', 'きゃんちゅー'],
  'きゃんちゅー': ['CANDY TUNE'],
  'SWEET STEADY': ['スイートステディ', 'すいすて'],
  'すいすて': ['SWEET STEADY'],
  // 坂道シリーズ
  '乃木坂46': ['乃木坂', 'のぎざか', 'のぎ', 'nogizaka46', 'nogi'],
  '櫻坂46': ['櫻坂', '欅坂46', '欅坂', 'けやき', 'さくらざか'],
  '日向坂46': ['日向坂', 'ひなた', 'ひなたざか', 'けやき坂46', 'hinatazaka46'],
  // ハロプロ
  'モーニング娘。': ['モー娘', 'モーニング娘', 'モーニング', 'モームス'],
  // 一般用語
  'タイムライン': ['TL', 'tl', 'たいむらいん'],
  'ダイレクトメッセージ': ['DM', 'dm', 'ダイレクト'],
  'リツイート': ['RT', 'rt', 'リポスト'],
  'ファボ': ['いいね', 'お気に入り', 'like'],
};

// 1つのクエリから全 variant を生成 (重要度順: 同義語 → 記号読み → 表記ゆらぎ)
export function generateVariants(query: string): string[] {
  const original = query.trim();
  if (!original) return [];
  const ordered: string[] = [];
  const seen = new Set<string>();
  const push = (v: string) => {
    const t = v.trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    ordered.push(t);
  };

  push(original);
  const normalized = normalize(original);

  // ★ Tier 1: 既知の同義語辞書 (最優先)
  for (const [key, syns] of Object.entries(COMMON_SYNONYMS)) {
    if (normalize(key) === normalized || syns.some((s) => normalize(s) === normalized)) {
      push(key);
      for (const s of syns) push(s);
    }
  }
  // 部分一致による同義語
  for (const [key, syns] of Object.entries(COMMON_SYNONYMS)) {
    if (normalized.length >= 2 && normalize(key).includes(normalized)) {
      push(key);
      for (const s of syns) push(s);
    }
  }

  // ★ Tier 2: 大文字小文字
  push(original.toLowerCase());
  push(original.toUpperCase());

  // ★ Tier 3: 全角/半角 (双方向)
  const halfWidth = fullToHalf(original);
  const fullWidth = halfToFull(original);
  if (halfWidth !== original) {
    push(halfWidth);
    push(halfWidth.toLowerCase());
  }
  if (fullWidth !== original) {
    push(fullWidth);
    push(fullWidth.toLowerCase());
  }
  // 半角→全角の同義語にも適用 (=LOVE → ＝LOVE 経由で ＝ラブ も拾う)
  for (const [key, syns] of Object.entries(COMMON_SYNONYMS)) {
    if (normalize(key) === normalize(halfWidth) || normalize(key) === normalize(fullWidth)) {
      push(key);
      for (const s of syns) push(s);
    }
  }

  // ★ Tier 4: 記号読み展開
  for (const [sym, readings] of Object.entries(SYMBOL_READINGS)) {
    if (original.includes(sym)) {
      for (const r of readings) {
        push(original.replaceAll(sym, r));
      }
      // 記号削除版
      push(original.replaceAll(sym, '').trim());
    }
  }

  // ★ Tier 5: カタカナ ↔ ひらがな
  const katakana = hiraganaToKatakana(halfWidth.toLowerCase());
  const hiragana = katakanaToHiragana(halfWidth.toLowerCase());
  if (katakana !== halfWidth) push(katakana);
  if (hiragana !== halfWidth) push(hiragana);

  // ★ Tier 6: ローマ字 → ひらがな
  if (/[a-z]/i.test(original)) {
    const lower = original.toLowerCase();
    const kana = romajiToHiragana(lower);
    if (kana !== lower) {
      push(kana);
      push(hiraganaToKatakana(kana));
    }
  }

  // ★ Tier 7: 空白除去
  push(original.replace(/\s+/g, ''));

  return ordered;
}

// バリアントセットでマッチするかチェック (テキスト含有)
export function matchesAnyVariant(text: string, variants: string[]): boolean {
  const t = normalize(text);
  return variants.some((v) => t.includes(normalize(v)));
}
