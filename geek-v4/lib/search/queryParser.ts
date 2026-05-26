// 高度なクエリパーサー
// 対応する構文:
// - "完全フレーズ"        → exact phrase
// - tag:ポケモン           → tag フィルタ
// - from:ニックネーム      → 投稿者 (今後)
// - -除外                  → 除外語
// - has:image / has:link   → メディア/出典あり
// - before:2025-01 / after:2024-12-01
// - score:>70              → 信頼スコア閾値
// - kind:fact|opinion|joke|wip
// - その他は通常キーワード扱い

export type ParsedQuery = {
  phrases: string[];          // 完全フレーズ
  keywords: string[];         // 通常キーワード (and)
  excludes: string[];         // 除外語
  tags: string[];             // tag: フィルタ
  hasMedia?: boolean;
  hasLink?: boolean;
  before?: Date;
  after?: Date;
  minScore?: number;
  maxScore?: number;
  kinds: string[];            // post kind
  raw: string;
};

// DoS 防止: 各 operator 値 / phrase / negation token に長さ制限を入れる
//   - OPERATOR_REGEX: 値部分を最大 80 文字に
//   - PHRASE_REGEX: ネスト引用符の問題を避けるため escape も許可
//   - NEG_REGEX: token 最大 80 文字に
// いずれも `{n,m}` 上限つきで内部は単一クラス (否定セット) を 1 回繰り返すだけ
// → linear time matching, catastrophic backtracking は発生しない。
const OPERATOR_REGEX = /\b(tag|from|has|before|after|score|kind):([^\s"]{1,80})/gi;
const PHRASE_REGEX = /"((?:[^"\\]|\\.){0,200})"/g;
const NEG_REGEX = /(?:^|\s)-(\S{1,80})/g;
// クエリ全体の最大長 — これ以上は ReDoS / メモリ食いつぶし対策で truncate
// 200 字以上の検索クエリは現実的なニーズが無いため厳しめに切り詰める。
const MAX_QUERY_LEN = 200;

export function parseQuery(raw: string): ParsedQuery {
  let work = raw.trim().slice(0, MAX_QUERY_LEN);
  const phrases: string[] = [];
  const excludes: string[] = [];
  const tags: string[] = [];
  const kinds: string[] = [];
  let hasMedia: boolean | undefined;
  let hasLink: boolean | undefined;
  let before: Date | undefined;
  let after: Date | undefined;
  let minScore: number | undefined;
  let maxScore: number | undefined;

  // 完全フレーズ
  work = work.replace(PHRASE_REGEX, (_, p1) => {
    phrases.push(p1.trim());
    return ' ';
  });

  // オペレータ
  work = work.replace(OPERATOR_REGEX, (_match, op: string, val: string) => {
    const lower = op.toLowerCase();
    if (lower === 'tag') tags.push(val.replace(/^#/, ''));
    else if (lower === 'has') {
      if (val === 'image' || val === 'media' || val === 'photo') hasMedia = true;
      else if (val === 'link' || val === 'url' || val === 'source') hasLink = true;
    } else if (lower === 'before') {
      const d = new Date(val);
      if (!isNaN(d.getTime())) before = d;
    } else if (lower === 'after') {
      const d = new Date(val);
      if (!isNaN(d.getTime())) after = d;
    } else if (lower === 'score') {
      const m = val.match(/^([><]=?)(\d+)$/);
      if (m) {
        const n = parseInt(m[2]!, 10);
        if (m[1] === '>') minScore = n + 1;
        else if (m[1] === '>=') minScore = n;
        else if (m[1] === '<') maxScore = n - 1;
        else if (m[1] === '<=') maxScore = n;
      } else {
        const n = parseInt(val, 10);
        if (!isNaN(n)) minScore = n;
      }
    } else if (lower === 'kind') {
      if (['fact', 'opinion', 'joke', 'wip'].includes(val)) kinds.push(val);
    }
    return ' ';
  });

  // 除外
  work = work.replace(NEG_REGEX, (_match, ex: string) => {
    excludes.push(ex.trim());
    return ' ';
  });

  // 残ったキーワード
  const keywords = work
    .split(/\s+/)
    .map((s) => s.trim().replace(/^#/, ''))
    .filter((s) => s.length > 0);

  return {
    phrases, keywords, excludes, tags, hasMedia, hasLink,
    before, after, minScore, maxScore, kinds, raw,
  };
}

// ============================================================
// Query Intent (2026-05 追加)
// ============================================================
// 「1 単語クエリは strict, 2 単語以上は loose (AND ベース)」 — Google 風の
// 入力意図解釈ルール。既存 parseQuery を呼び出した後に補助的に判定する pure helper。
//
// strict mode → 完全一致 / プレフィックス一致を強く優先
// loose mode  → AND マッチ (全 keyword が hit) を許容、部分一致 OK
//
// scoring 側で使う想定。既存 export を壊さないために `getQueryMode()` を新規追加。
//
// "strict" — 例: "ポケモン" — entity 一致を強く優先したい
// "loose"  — 例: "ポケモン アニメ" — 両方の語に hit する post を引きたい
// "phrase" — 例: '"進撃の巨人"' — exact phrase match のみ
export type QueryMode = 'strict' | 'loose' | 'phrase';

export function getQueryMode(q: ParsedQuery): QueryMode {
  if (q.phrases.length > 0) return 'phrase';
  // tag: operator はあくまで構文 — keywords 単独の判定基準
  if (q.keywords.length <= 1) return 'strict';
  return 'loose';
}

// 表示用にオペレータ説明を返す
export function describeQuery(q: ParsedQuery): { label: string; emoji: string }[] {
  const out: { label: string; emoji: string }[] = [];
  for (const p of q.phrases) out.push({ emoji: '🔍', label: `"${p}"` });
  for (const t of q.tags) out.push({ emoji: '#️⃣', label: `タグ: ${t}` });
  for (const e of q.excludes) out.push({ emoji: '🚫', label: `除外: ${e}` });
  if (q.hasMedia) out.push({ emoji: '🖼', label: '画像あり' });
  if (q.hasLink) out.push({ emoji: '🔗', label: '出典あり' });
  if (q.before) out.push({ emoji: '⏰', label: `〜${q.before.toLocaleDateString('ja')}` });
  if (q.after) out.push({ emoji: '⏰', label: `${q.after.toLocaleDateString('ja')}〜` });
  if (q.minScore !== undefined) out.push({ emoji: '🛡', label: `信頼≥${q.minScore}` });
  for (const k of q.kinds) out.push({ emoji: '🏷', label: `種類: ${k}` });
  return out;
}
