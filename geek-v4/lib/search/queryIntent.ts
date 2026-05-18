// ============================================================
// Query Intent Classifier
// ============================================================
// クエリを 6 つの大カテゴリに分類:
//   - person:     人名 (例: "大谷翔平", "賀喜遥香", "ohtani")
//   - work:       作品 (例: "鬼滅の刃", "ポケモン", "原神")
//   - place:      場所 (例: "東京", "京都", "新宿")
//   - year:       時期 (例: "2025", "令和7年")
//   - question:   質問 (例: "おすすめは？", "誰", "なぜ")
//   - tag:        汎用タグ (デフォルト)
//
// 分類は完全にルールベース (パターン辞書 + 文字種類)。
// 軽量・即時 & 説明可能。
// ============================================================

export type QueryIntent =
  | { kind: 'person'; tokens: string[] }
  | { kind: 'work'; tokens: string[] }
  | { kind: 'place'; tokens: string[] }
  | { kind: 'year'; year: number }
  | { kind: 'question'; subject: string }
  | { kind: 'tag'; tokens: string[] };

// 著名人マーカー: 名前っぽい文字列の特徴
const PERSON_HINTS_END = ['さん', 'くん', 'ちゃん'];
const PERSON_NAMES = new Set<string>([
  '大谷翔平', '大谷', '佐々木朗希', '三笘薫', '久保建英', '羽生結弦', '藤井聡太',
  '賀喜遥香', '山下美月', '与田祐希', '遠藤さくら', '小坂菜緒', '齋藤京子',
  '兎田ぺこら', '宝鐘マリン', '葛葉', '叶', '月ノ美兎', '雪花ラミィ',
  '菅田将暉', '吉沢亮', '広瀬すず', '石原さとみ', '長澤まさみ', '橋本環奈',
  'ヒカキン', 'はじめしゃちょー',
  'ohtani', 'mitoma', 'kubo', 'pekora', 'marine',
]);

const WORK_NAMES = new Set<string>([
  '鬼滅の刃', '呪術廻戦', '進撃の巨人', 'ワンピース', 'ナルト',
  'スパイファミリー', '推しの子', '葬送のフリーレン', 'ダンダダン',
  'チェンソーマン', 'ぼっち・ざ・ろっく', 'ジョジョ',
  'ポケモン', 'マインクラフト', '原神', 'スプラトゥーン', 'ゼルダ',
  'フォートナイト', 'モンハン', 'ファイナルファンタジー', 'ドラゴンクエスト',
]);

const PLACE_NAMES = new Set<string>([
  '東京', '京都', '大阪', '渋谷', '新宿', '原宿', '池袋', '六本木',
  '名古屋', '福岡', '札幌', '横浜', '神戸',
  'シンガポール', '台湾', 'ソウル', 'バンコク',
]);

const QUESTION_MARKERS = ['?', '？', 'なぜ', '誰', 'どこ', 'いつ', 'おすすめ', 'おすすめは', 'どれ', 'どっち'];

// 年っぽい: 4桁数字 (2000-2099) or "令和N年" "平成N年"
const YEAR_REGEX = /^(?:(20\d{2})|令和(\d{1,2})年|平成(\d{1,2})年)/;

export function classifyIntent(query: string): QueryIntent {
  const q = query.trim();
  const tokens = q.split(/\s+|　/).filter(Boolean);

  // Year
  const yearM = YEAR_REGEX.exec(q);
  if (yearM) {
    let year: number;
    if (yearM[1]) year = parseInt(yearM[1], 10);
    else if (yearM[2]) year = 2018 + parseInt(yearM[2], 10);  // 令和元年 = 2019
    else year = 1988 + parseInt(yearM[3]!, 10);  // 平成元年 = 1989
    return { kind: 'year', year };
  }

  // Question
  if (QUESTION_MARKERS.some((m) => q.includes(m))) {
    return { kind: 'question', subject: q.replace(/[?？]/g, '').trim() };
  }

  // Person
  if (PERSON_NAMES.has(q)) return { kind: 'person', tokens };
  if (PERSON_HINTS_END.some((s) => q.endsWith(s))) return { kind: 'person', tokens };

  // Work
  if (WORK_NAMES.has(q)) return { kind: 'work', tokens };

  // Place
  if (PLACE_NAMES.has(q)) return { kind: 'place', tokens };

  return { kind: 'tag', tokens };
}

export function intentEmoji(intent: QueryIntent): string {
  switch (intent.kind) {
    case 'person':   return '👤';
    case 'work':     return '📺';
    case 'place':    return '📍';
    case 'year':     return '📅';
    case 'question': return '❓';
    default:         return '🏷️';
  }
}

export function intentLabel(intent: QueryIntent): string {
  switch (intent.kind) {
    case 'person':   return '人名';
    case 'work':     return '作品';
    case 'place':    return '場所';
    case 'year':     return '時期';
    case 'question': return '質問';
    default:         return 'タグ';
  }
}
