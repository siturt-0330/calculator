// 検索URLの組み立て / 解析ユーティリティ。
//
// 想定形式: `/search?q=<query>&category=<category>&sort=<sort>`
//
// - `q` は必須 (空文字でも可)。常に先頭に置く。
// - `category` / `sort` は省略可。undefined のときはクエリに付かない。
// - すべての値は encodeURIComponent でエスケープしてから連結する。
//   (ポケモン → %E3%83%9D%E3%82%B1%E3%83%A2%E3%83%B3)
// - 解析側は `decodeURIComponent` を try/catch でラップし、壊れた URL でも落ちないようにする。
//
// テスト指針 (実行可能な test ではないコメントだけ):
// - buildSearchShareUrl({ q: 'ポケモン' })
//     → '/search?q=%E3%83%9D%E3%82%B1%E3%83%A2%E3%83%B3'
// - buildSearchShareUrl({ q: 'a', category: 'posts', sort: 'new' })
//     → '/search?q=a&category=posts&sort=new'
// - buildSearchShareUrl({ q: 'a b&c' })
//     → '/search?q=a%20b%26c'
// - parseSearchShareUrl('/search?q=%E3%83%9D&category=posts')
//     → { q: 'ポ', category: 'posts' }
// - parseSearchShareUrl('') → { q: '' }
// - parseSearchShareUrl('/search') → { q: '' }
// - parseSearchShareUrl('/search?q=hi&sort=new') → { q: 'hi', sort: 'new' }
// - parseSearchShareUrl('/search?q=%E2%98%83&category=tags&sort=popular&extra=ignored')
//     → { q: '☃', category: 'tags', sort: 'popular' }
// - 壊れた %XX も q='' (or 残りはそのまま) 程度で例外を投げない。

export type SearchShareOpts = {
  q: string;
  category?: string;
  sort?: string;
};

export type ParsedSearchShare = {
  q: string;
  category?: string;
  sort?: string;
};

const BASE = '/search';

/**
 * 共有用の検索 URL を組み立てる。
 *
 * - q は常に含まれる (空文字でも `?q=` で出る)。
 * - category / sort は値が truthy なときだけ追加される。
 *
 * 例:
 *   buildSearchShareUrl({ q: 'ポケモン', category: 'posts', sort: 'new' })
 *     → '/search?q=%E3%83%9D%E3%82%B1%E3%83%A2%E3%83%B3&category=posts&sort=new'
 */
export function buildSearchShareUrl(opts: SearchShareOpts): string {
  const parts: string[] = [];
  parts.push(`q=${encodeURIComponent(opts.q ?? '')}`);
  if (opts.category) {
    parts.push(`category=${encodeURIComponent(opts.category)}`);
  }
  if (opts.sort) {
    parts.push(`sort=${encodeURIComponent(opts.sort)}`);
  }
  return `${BASE}?${parts.join('&')}`;
}

/**
 * 共有 URL を逆解析する。
 *
 * - `q` は無くても空文字で返す (UI 側で missing と空クエリを区別したくない想定)。
 * - 想定外の追加パラメータは無視する。
 * - 壊れた % エスケープでも throw しない (decodeURIComponent の失敗は raw を返す)。
 */
export function parseSearchShareUrl(url: string): ParsedSearchShare {
  const out: ParsedSearchShare = { q: '' };
  if (!url || typeof url !== 'string') return out;

  const qIdx = url.indexOf('?');
  if (qIdx === -1) return out;

  const query = url.slice(qIdx + 1);
  if (!query) return out;

  // フラグメント (#...) は捨てる
  const hashIdx = query.indexOf('#');
  const cleaned = hashIdx === -1 ? query : query.slice(0, hashIdx);

  for (const segment of cleaned.split('&')) {
    if (!segment) continue;
    const eq = segment.indexOf('=');
    const rawKey = eq === -1 ? segment : segment.slice(0, eq);
    const rawVal = eq === -1 ? '' : segment.slice(eq + 1);
    const key = safeDecode(rawKey);
    const val = safeDecode(rawVal);

    if (key === 'q') out.q = val;
    else if (key === 'category' && val) out.category = val;
    else if (key === 'sort' && val) out.sort = val;
    // 他は無視
  }

  return out;
}

/** decodeURIComponent を例外なしで実行する。失敗時は raw を返す。 */
function safeDecode(s: string): string {
  if (!s) return '';
  try {
    return decodeURIComponent(s.replace(/\+/g, '%20'));
  } catch {
    return s;
  }
}
