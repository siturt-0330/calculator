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

// ひらがな → ローマ字 (検索 recall 用; "ぎーく" → "giiku" / "geek" を意識)
// ROMAJI_HIRAGANA を逆方向に適用、長音 ー は直前母音を duplicate
const HIRA_TO_ROMA: [string, string][] = [
  ['きゃ', 'kya'], ['きゅ', 'kyu'], ['きょ', 'kyo'],
  ['しゃ', 'sha'], ['しゅ', 'shu'], ['しょ', 'sho'], ['し', 'shi'],
  ['ちゃ', 'cha'], ['ちゅ', 'chu'], ['ちょ', 'cho'], ['ち', 'chi'], ['つ', 'tsu'],
  ['にゃ', 'nya'], ['にゅ', 'nyu'], ['にょ', 'nyo'],
  ['ひゃ', 'hya'], ['ひゅ', 'hyu'], ['ひょ', 'hyo'],
  ['みゃ', 'mya'], ['みゅ', 'myu'], ['みょ', 'myo'],
  ['りゃ', 'rya'], ['りゅ', 'ryu'], ['りょ', 'ryo'],
  ['ぎゃ', 'gya'], ['ぎゅ', 'gyu'], ['ぎょ', 'gyo'],
  ['じゃ', 'ja'], ['じゅ', 'ju'], ['じょ', 'jo'], ['じ', 'ji'],
  ['びゃ', 'bya'], ['びゅ', 'byu'], ['びょ', 'byo'],
  ['ぴゃ', 'pya'], ['ぴゅ', 'pyu'], ['ぴょ', 'pyo'],
  ['ふぁ', 'fa'], ['ふぃ', 'fi'], ['ふぇ', 'fe'], ['ふぉ', 'fo'],
  ['か', 'ka'], ['き', 'ki'], ['く', 'ku'], ['け', 'ke'], ['こ', 'ko'],
  ['さ', 'sa'], ['す', 'su'], ['せ', 'se'], ['そ', 'so'],
  ['た', 'ta'], ['て', 'te'], ['と', 'to'],
  ['な', 'na'], ['に', 'ni'], ['ぬ', 'nu'], ['ね', 'ne'], ['の', 'no'],
  ['は', 'ha'], ['ひ', 'hi'], ['ふ', 'fu'], ['へ', 'he'], ['ほ', 'ho'],
  ['ま', 'ma'], ['み', 'mi'], ['む', 'mu'], ['め', 'me'], ['も', 'mo'],
  ['や', 'ya'], ['ゆ', 'yu'], ['よ', 'yo'],
  ['ら', 'ra'], ['り', 'ri'], ['る', 'ru'], ['れ', 're'], ['ろ', 'ro'],
  ['わ', 'wa'], ['を', 'wo'], ['ん', 'n'],
  ['が', 'ga'], ['ぎ', 'gi'], ['ぐ', 'gu'], ['げ', 'ge'], ['ご', 'go'],
  ['ざ', 'za'], ['ず', 'zu'], ['ぜ', 'ze'], ['ぞ', 'zo'],
  ['だ', 'da'], ['で', 'de'], ['ど', 'do'],
  ['ば', 'ba'], ['び', 'bi'], ['ぶ', 'bu'], ['べ', 'be'], ['ぼ', 'bo'],
  ['ぱ', 'pa'], ['ぴ', 'pi'], ['ぷ', 'pu'], ['ぺ', 'pe'], ['ぽ', 'po'],
  ['あ', 'a'], ['い', 'i'], ['う', 'u'], ['え', 'e'], ['お', 'o'],
];

const VOWEL_OF = { a: 'a', i: 'i', u: 'u', e: 'e', o: 'o' } as Record<string, string>;

/**
 * ひらがな (＋カタカナ) → ローマ字。
 * 長音符「ー」は直前のローマ字母音で展開する。
 * 入力例: "ぎーく" → "gi-ku"... ではなく → "giiku" (長音→母音 duplicate)
 * recall を上げる目的なので strict ではない。
 */
export function hiraganaToRomaji(s: string): string {
  // まずカタカナをひらがなに統一
  let cur = s.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
  let out = '';
  let i = 0;
  while (i < cur.length) {
    // 2 文字スキャン (拗音優先)
    const two = cur.slice(i, i + 2);
    const found2 = HIRA_TO_ROMA.find(([k]) => k === two);
    if (found2) {
      out += found2[1];
      i += 2;
      continue;
    }
    const one = cur[i]!;
    // 長音「ー」: 直前ローマ字の最後が母音ならそれを duplicate
    if (one === 'ー' && out.length > 0) {
      const last = out[out.length - 1]!;
      if (VOWEL_OF[last]) out += last;
      i++;
      continue;
    }
    // 促音「っ」: 次の音の頭子音を duplicate (例: っき → kki)
    if (one === 'っ') {
      const next2 = cur.slice(i + 1, i + 3);
      const nfound = HIRA_TO_ROMA.find(([k]) => k === next2) ??
        HIRA_TO_ROMA.find(([k]) => k === cur[i + 1]);
      if (nfound) {
        const head = nfound[1][0]!;
        if (head !== 'a' && head !== 'i' && head !== 'u' && head !== 'e' && head !== 'o') {
          out += head;
        }
      }
      i++;
      continue;
    }
    const found1 = HIRA_TO_ROMA.find(([k]) => k === one);
    if (found1) {
      out += found1[1];
    } else {
      out += one; // 漢字や記号はそのまま
    }
    i++;
  }
  return out;
}

// 一般的な略語/同義 (有名アイドル等)
const COMMON_SYNONYMS: Record<string, string[]> = {
  // ============ アイドル ============
  '=LOVE': ['イコラブ', 'いこらぶ', '=ラブ', '＝ラブ', 'イコールラブ', 'ikorabu', 'ikolove'],
  'イコラブ': ['=LOVE', '＝LOVE', '=love', '=ラブ'],
  '≠ME': ['ノイミー', 'のいみー', 'ノットイコールミー', 'notequalme'],
  'ノイミー': ['≠ME', '≠me', 'ノットイコールミー'],
  '≒JOY': ['ニアジョイ', 'にあじょい', 'ニアリーイコールジョイ'],
  'ニアジョイ': ['≒JOY', '≒joy', 'ニアリーイコールジョイ'],
  'FRUITS ZIPPER': ['フルーツジッパー', 'ふるっぱー', 'ふるーつじっぱー'],
  'ふるっぱー': ['FRUITS ZIPPER', 'fruits zipper', 'フルーツジッパー'],
  'CUTIE STREET': ['キューティーストリート', 'きゅーすと', 'きゅーてぃーすとりーと'],
  'きゅーすと': ['CUTIE STREET', 'cutie street'],
  'CANDY TUNE': ['キャンディーチューン', 'きゃんちゅー'],
  'きゃんちゅー': ['CANDY TUNE'],
  'SWEET STEADY': ['スイートステディ', 'すいすて'],
  'すいすて': ['SWEET STEADY'],
  '乃木坂46': ['乃木坂', 'のぎざか', 'のぎ', 'nogizaka', 'nogizaka46', 'nogi'],
  'nogizaka': ['乃木坂46', '乃木坂', 'のぎざか'],
  '櫻坂46': ['櫻坂', '欅坂46', '欅坂', 'けやき', 'さくらざか', 'sakurazaka', 'sakurazaka46'],
  'sakurazaka': ['櫻坂46', '櫻坂', 'さくらざか'],
  '日向坂46': ['日向坂', 'ひなた', 'ひなたざか', 'けやき坂46', 'hinatazaka', 'hinatazaka46'],
  'hinatazaka': ['日向坂46', '日向坂', 'ひなたざか'],
  'AKB48': ['AKB', 'akb', 'えーけーびー'],
  'akb': ['AKB48', 'AKB', 'えーけーびー'],
  'モーニング娘。': ['モー娘', 'モーニング娘', 'モーニング', 'モームス', 'morning musume'],
  'morning': ['モーニング娘。', 'モーニング娘', 'morning musume'],
  'アイドル': ['idol', 'idle', 'アイドル', 'いどる', 'ido'],
  'idol': ['アイドル', 'いどる', 'idle'],

  // ============ アニメ・マンガ ============
  'アニメ': ['anime', 'あにめ', 'animation', 'アニメーション'],
  'anime': ['アニメ', 'あにめ', 'animation', 'アニメーション'],
  'マンガ': ['manga', 'まんが', '漫画', 'コミック', 'comic'],
  'manga': ['マンガ', 'まんが', '漫画', 'コミック'],
  '漫画': ['マンガ', 'manga', 'まんが', 'コミック', 'comic'],
  '鬼滅の刃': ['kimetsu', 'kimetsunoyaiba', 'demonslayer', '鬼滅', 'きめつ'],
  'kimetsu': ['鬼滅の刃', '鬼滅', 'きめつ', 'demonslayer'],
  '呪術廻戦': ['jujutsu', 'jujutsukaisen', 'じゅじゅつかいせん', '呪術'],
  'jujutsu': ['呪術廻戦', '呪術', 'jujutsukaisen', 'じゅじゅつ'],
  'ワンピース': ['onepiece', 'one piece', 'op'],
  'onepiece': ['ワンピース', 'one piece'],
  'ナルト': ['naruto', 'なると', '尾田'],
  'naruto': ['ナルト', 'なると'],
  '進撃の巨人': ['shingeki', 'attackontitan', 'aot', '進撃', 'しんげき'],
  'shingeki': ['進撃の巨人', '進撃', 'attackontitan'],
  'スパイファミリー': ['spyfamily', 'spy family', 'すぱいふぁみりー'],
  'spyfamily': ['スパイファミリー', 'spy family'],
  '推しの子': ['oshinoko', '推し子', 'oshino ko'],
  'oshinoko': ['推しの子', '推し子'],

  // ============ ゲーム ============
  'ゲーム': ['game', 'gaming', 'げーむ', 'video game'],
  'game': ['ゲーム', 'げーむ', 'gaming'],
  'ポケモン': ['pokemon', 'pokémon', 'ぽけもん', 'pkmn', 'pocketmonster', 'pocket monster'],
  'pokemon': ['ポケモン', 'ぽけもん', 'pokémon', 'pkmn'],
  'マインクラフト': ['minecraft', 'マイクラ', 'まいくら'],
  'minecraft': ['マインクラフト', 'マイクラ', 'まいくら'],
  'マイクラ': ['minecraft', 'マインクラフト', 'まいくら'],
  'フォートナイト': ['fortnite', 'ふぉーとないと'],
  'fortnite': ['フォートナイト', 'ふぉーとないと'],
  'スプラトゥーン': ['splatoon', 'スプラ', 'すぷら'],
  'splatoon': ['スプラトゥーン', 'スプラ'],
  '原神': ['genshin', 'genshinimpact', 'げんしん'],
  'genshin': ['原神', 'げんしん', 'genshinimpact'],
  'ゼルダ': ['zelda', 'thelegendofzelda', 'ぜるだ'],
  'zelda': ['ゼルダ', 'ぜるだ'],
  'モンハン': ['monsterhunter', 'mh', 'monhan', 'モンスターハンター'],
  'monhan': ['モンハン', 'モンスターハンター', 'monsterhunter'],
  'FF': ['ファイナルファンタジー', 'finalfantasy', 'final fantasy', 'ff14', 'ff7'],
  'finalfantasy': ['FF', 'ファイナルファンタジー'],

  // ============ Vtuber ============
  'Vtuber': ['vtuber', 'ブイチューバー', 'バーチャルyoutuber', 'virtual youtuber', 'ぶいちゅーばー'],
  'vtuber': ['Vtuber', 'ブイチューバー', 'バーチャルyoutuber'],
  'ホロライブ': ['hololive', 'ホロ', 'ほろ', 'holo'],
  'hololive': ['ホロライブ', 'ホロ', 'ほろ'],
  'にじさんじ': ['nijisanji', 'nijisan', 'にじ', 'nij'],
  'nijisanji': ['にじさんじ', 'にじ'],
  '兎田ぺこら': ['pekora', 'usadapekora', 'ぺこら', 'うさだぺこら'],
  'pekora': ['兎田ぺこら', 'ぺこら', 'usadapekora'],
  '宝鐘マリン': ['marine', 'houshoumarine', 'マリン', 'まりん'],
  'marine': ['宝鐘マリン', 'マリン', 'houshoumarine'],

  // ============ スポーツ ============
  '野球': ['baseball', 'やきゅう', 'プロ野球', 'mlb', 'npb'],
  'baseball': ['野球', 'やきゅう', 'プロ野球'],
  'サッカー': ['soccer', 'football', 'さっかー', 'フットボール'],
  'soccer': ['サッカー', 'football', 'さっかー'],
  'football': ['サッカー', 'soccer', 'さっかー', 'フットボール', 'アメフト'],
  'バスケ': ['basketball', 'バスケットボール', 'ばすけ', 'nba'],
  'basketball': ['バスケ', 'バスケットボール', 'nba'],
  '大谷翔平': ['ohtani', 'shoheiohtani', 'おおたに'],
  'ohtani': ['大谷翔平', '大谷', 'おおたに'],
  '三笘薫': ['mitoma', 'kaoru mitoma', 'みとま'],
  'mitoma': ['三笘薫', '三笘', 'みとま'],
  'F1': ['f1', 'formula1', 'formula 1', 'エフワン'],
  'formula1': ['F1', 'formula 1'],

  // ============ 音楽 ============
  '音楽': ['music', 'みゅーじっく', 'おんがく', 'song'],
  'music': ['音楽', 'みゅーじっく', 'song'],
  'J-POP': ['jpop', 'j-pop', 'japanesepop', 'ジェイポップ', 'にほんのおんがく'],
  'jpop': ['J-POP', 'j-pop', 'jpop', 'ジェイポップ'],
  'K-POP': ['kpop', 'k-pop', 'koreanpop', 'ケイポップ'],
  'kpop': ['K-POP', 'k-pop', 'ケイポップ'],
  'BTS': ['bts', 'バンタン', '防弾少年団', 'beyond the scene'],
  'bts': ['BTS', 'バンタン', '防弾少年団'],

  // ============ 趣味・カルチャー ============
  'オタク': ['otaku', 'おたく', 'お宅', 'nerd', 'geek'],
  'otaku': ['オタク', 'おたく', 'お宅'],
  'コスプレ': ['cosplay', 'cos', 'こすぷれ'],
  'cosplay': ['コスプレ', 'こすぷれ', 'cos'],
  'コミケ': ['comiket', 'comicmarket', 'comic market', 'コミックマーケット'],
  'comiket': ['コミケ', 'コミックマーケット', 'comicmarket'],
  '同人': ['doujin', 'fanart', 'fanfic', 'どうじん'],
  'doujin': ['同人', 'どうじん', 'fanart'],
  'カメラ': ['camera', 'カメラ', 'photography', 'photo'],
  'camera': ['カメラ', 'photography'],
  '車': ['car', 'cars', 'automobile', 'くるま'],
  'car': ['車', 'くるま', 'cars', 'automobile'],
  'バイク': ['bike', 'motorcycle', 'motor cycle', 'ばいく'],
  'bike': ['バイク', 'ばいく', 'motorcycle'],

  // ============ ビジネス・投資 ============
  '投資': ['investment', 'invest', 'とうし'],
  'investment': ['投資', 'invest', 'とうし'],
  '副業': ['sidehustle', 'side hustle', 'ふくぎょう', 'side job'],
  'sidehustle': ['副業', 'side hustle', 'ふくぎょう'],
  '起業': ['startup', 'start up', 'きぎょう', 'entrepreneurship'],
  'startup': ['起業', 'きぎょう', 'start up'],
  'NISA': ['nisa', 'ニーサ', 'にーさ', '少額投資非課税'],
  'nisa': ['NISA', 'ニーサ'],
  'iDeCo': ['ideco', 'イデコ', 'いでこ', '個人型確定拠出年金'],
  'ideco': ['iDeCo', 'イデコ'],
  'FIRE': ['fire', 'ファイア', '早期退職'],
  'fire': ['FIRE', 'ファイア'],

  // ============ YouTuber ============
  'YouTuber': ['youtuber', 'ようつーばー', 'ユーチューバー'],
  'youtuber': ['YouTuber', 'ユーチューバー', 'ようつーばー'],
  'ヒカキン': ['hikakin', 'ひかきん', 'hikakintv'],
  'hikakin': ['ヒカキン', 'ひかきん'],

  // ============ SNS 一般用語 ============
  'タイムライン': ['TL', 'tl', 'たいむらいん', 'timeline'],
  'timeline': ['タイムライン', 'TL', 'たいむらいん'],
  'ダイレクトメッセージ': ['DM', 'dm', 'ダイレクト', 'direct message'],
  'dm': ['DM', 'ダイレクトメッセージ', 'direct message'],
  'リツイート': ['RT', 'rt', 'リポスト', 'retweet', 'repost'],
  'retweet': ['リツイート', 'リポスト'],
  'ファボ': ['いいね', 'お気に入り', 'like', 'favorite', 'fav'],
  'like': ['いいね', 'ファボ', 'お気に入り', 'favorite'],
};

// DoS 防止: variant 数の上限 — 異常に大きいクエリで爆発しないよう全 push に
// 通過させる。
const MAX_VARIANTS = 24;
// クエリ長の上限 — "=====" のような繰り返し記号で variant が爆発する攻撃を抑止
const MAX_QUERY_LEN = 80;

// 1つのクエリから全 variant を生成 (重要度順: 同義語 → 記号読み → 表記ゆらぎ)
export function generateVariants(query: string): string[] {
  // メモリ食い対策: 3 連続以上の同じ文字を 2 文字に圧縮 ("ああああ..." → "ああ")
  // romajiToHiragana 等で爆発するのを防ぐ
  const deduped = query.replace(/(.)\1{2,}/g, '$1$1');
  const original = deduped.trim().slice(0, MAX_QUERY_LEN);
  if (!original) return [];
  const ordered: string[] = [];
  const seen = new Set<string>();
  const push = (v: string) => {
    if (ordered.length >= MAX_VARIANTS) return;  // hard cap
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

  // ★ Tier 6.5: ひらがな/カタカナ → ローマ字 (例: "ぎーく" → "geek")
  // 「Geek」「Cake」のような英字コミュ名をひらがな入力でも見つけられるようにする
  // 日本語→英語の音韻ヒューリスティック:
  //   - ii → ee  (長音 /i:/ は英語で多く "ee")
  //   - aa → a   (長音 /a:/ は英語で多く 1 つの "a")
  //   - 末尾 ku/su/tu/fu/mu/ru → 子音だけ ("ku$" → "k")
  if (/[ぁ-ゖァ-ヶー]/.test(original)) {
    const literal = hiraganaToRomaji(original); // 例: "giiku"
    if (literal && literal !== original) {
      push(literal);
      // 重母音を 1 つに圧縮
      const collapsed = literal.replace(/([aiueo])\1/g, '$1'); // "giku"
      if (collapsed !== literal) push(collapsed);
      // 英語化 1: ii → ee  (例: "giiku" → "geeku")
      const eeForm = literal.replace(/ii/g, 'ee');
      if (eeForm !== literal) push(eeForm);
      // 英語化 2: 末尾の母音子音 (ku/su/tu/fu/mu/ru/nu/gu/bu/pu) → 子音だけ
      //   例: "geeku" → "geek", "keeku" → "keek", "kakeu" → "kake"
      const dropTrailU = eeForm.replace(/([ksthfmrgnbpvz])u$/, '$1');
      if (dropTrailU !== eeForm) push(dropTrailU);
      // 同じ処理を collapsed にも適用 (recall 最大化)
      const dropTrailU2 = collapsed.replace(/([ksthfmrgnbpvz])u$/, '$1');
      if (dropTrailU2 !== collapsed) push(dropTrailU2);
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

// ユーザーに見せる「これも検索してます」プレビュー用
// generateVariants の結果のうち、原文と明らかに違う日本語/カタカナ表記を優先で返す
// 例: "pokemon" → ["ポケモン", "ぽけもん"]
//     "ido"     → ["アイドル", "イド"]
//     "anime"   → ["アニメ", "あにめ"]
export function previewVariants(query: string, lang: string = 'ja', limit = 4): string[] {
  if (!query.trim()) return [];
  const lower = query.toLowerCase().trim();
  const all = generateVariants(query);
  // 原文・大文字/小文字違いだけ・空白除去のみは除外
  const filter = (v: string) => {
    const vl = v.toLowerCase().trim();
    if (vl === lower) return false;
    if (vl === lower.replace(/\s+/g, '')) return false;
    if (vl === lower.toUpperCase().toLowerCase()) return false;
    return true;
  };
  const filtered = all.filter(filter);
  if (lang === 'ja') {
    // 日本語ユーザーには日本語表記を先頭に
    const isJapanese = (s: string) => /[぀-ヿ一-鿿]/.test(s);
    filtered.sort((a, b) => {
      const aJ = isJapanese(a) ? 0 : 1;
      const bJ = isJapanese(b) ? 0 : 1;
      return aJ - bJ;
    });
  }
  // 重複除去 + 上位 limit 件
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of filtered) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= limit) break;
  }
  return out;
}
