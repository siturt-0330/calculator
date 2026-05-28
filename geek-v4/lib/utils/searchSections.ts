// ============================================================
// searchSections.ts — 検索結果をセクション化する純粋関数
// ------------------------------------------------------------
// 役割:
//   - 投稿 / BBS / コミュ / タグ / ユーザー の 5 セクションへ分割し、
//     各セクションの上位 N 件と総件数を返す
//   - UI 側はそれをそのまま描画すれば「セクション + もっと見る (N - 3)」を
//     再現できる
//   - 「ユーザー」セクションは現状 API 未整備でも、データ側が空配列を渡せば
//     セクションが空のまま落ちる (= 描画されない) ようにする
//
// 設計判断:
//   - 純粋関数 (副作用なし) — テストしやすさを優先
//   - generics で items 型を保持し、UI 側で型を失わない
//   - kind は安定 ID (string literal) で公開し、UI が key にできる
//   - topN <= 0 のときは何も切り出さない (== 全件返す previewItems = items)
// ============================================================

export type SearchSectionKind = 'posts' | 'bbs' | 'communities' | 'tags' | 'users';

/**
 * 1 セクション分のデータ。
 *
 * - kind: セクションの識別子 (UI が key / route 判断に使う)
 * - title: 表示タイトル (日本語)
 * - count: そのセクションの総ヒット件数 (= items.length)
 * - items: 全件 (UI 側で all/expand 時に使う)
 * - previewItems: topN 件 (== UI が「セクション内 3 件」表示用)
 * - hasMore: count > previewItems.length
 * - overflow: count - previewItems.length (もっと見るで残り何件か)
 */
export type SearchSectionData<T = unknown> = {
  kind: SearchSectionKind;
  title: string;
  count: number;
  items: T[];
  previewItems: T[];
  hasMore: boolean;
  overflow: number;
};

/**
 * 検索結果の入力。各フィールドは省略可 (= 空配列扱い)。
 *
 * 型は generics ではなく unknown を許容 — 呼び出し側 (search.tsx) が
 * 各セクションの型を知っているのでそちらでキャストする想定。
 */
export type SearchResultBundle = {
  posts?: readonly unknown[];
  bbsThreads?: readonly unknown[];
  communities?: readonly unknown[];
  tags?: readonly unknown[];
  users?: readonly unknown[];
};

const SECTION_TITLES: Record<SearchSectionKind, string> = {
  posts: '投稿',
  bbs: '掲示板',
  communities: 'コミュ',
  tags: 'タグ',
  users: 'ユーザー',
};

// セクションの並び順 (= 仕様: 投稿 → BBS → コミュ → タグ → ユーザー)
const SECTION_ORDER: SearchSectionKind[] = ['posts', 'bbs', 'communities', 'tags', 'users'];

function clampTopN(topN: number): number {
  if (!Number.isFinite(topN)) return 0;
  if (topN < 0) return 0;
  return Math.floor(topN);
}

/**
 * results を 5 セクションに切り分け、各セクションの上位 topN 件を返す。
 *
 * - items が空のセクションは戻り値に含めない (UI が空セクションを描かなくて済む)
 * - topN === 0 は「プレビュー無し = 全件を items だけで返す」と解釈する
 *   (UI 側で「全件表示モード」のときに使える)
 */
export function buildSearchSections(
  results: SearchResultBundle,
  topN: number = 3,
): SearchSectionData[] {
  const n = clampTopN(topN);
  const bundle: Record<SearchSectionKind, readonly unknown[]> = {
    posts: results.posts ?? [],
    bbs: results.bbsThreads ?? [],
    communities: results.communities ?? [],
    tags: results.tags ?? [],
    users: results.users ?? [],
  };

  const sections: SearchSectionData[] = [];
  for (const kind of SECTION_ORDER) {
    const raw = bundle[kind];
    const items = Array.isArray(raw) ? raw.slice() : [];
    if (items.length === 0) continue;

    const previewItems = n > 0 ? items.slice(0, n) : items.slice();
    const overflow = Math.max(0, items.length - previewItems.length);
    const hasMore = overflow > 0;

    sections.push({
      kind,
      title: SECTION_TITLES[kind],
      count: items.length,
      items,
      previewItems,
      hasMore,
      overflow,
    });
  }
  return sections;
}

/**
 * 全セクションの合計件数を返す。empty state 判定に使う。
 */
export function totalResultCount(results: SearchResultBundle): number {
  return (
    (results.posts?.length ?? 0) +
    (results.bbsThreads?.length ?? 0) +
    (results.communities?.length ?? 0) +
    (results.tags?.length ?? 0) +
    (results.users?.length ?? 0)
  );
}

/**
 * セクション kind から日本語タイトルを返す helper (UI が再利用しやすいよう公開)。
 */
export function sectionTitle(kind: SearchSectionKind): string {
  return SECTION_TITLES[kind];
}

/**
 * セクション順 (UI の再描画順保証に使う) を返す helper。
 */
export function sectionOrder(): readonly SearchSectionKind[] {
  return SECTION_ORDER;
}
