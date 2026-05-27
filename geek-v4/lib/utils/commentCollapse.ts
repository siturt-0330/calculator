// ============================================================
// commentCollapse — 低品質コメントの自動 collapse 判定 + グループ化
// ------------------------------------------------------------
// Reddit ガイド 5.3 / 5.10 章: 「低品質コメントは非表示ではなく折りたたみ」
// で hivemind を抑制しつつ、誤判定を救済できるようにする。
//
// 仕様:
//   1. shouldCollapseComment — 1 件の comment が collapse 対象かを判定
//        - concern_count >= 3                       → collapse
//        - score_proxy (likes - concerns) <= -2     → collapse
//        - is_hidden_by_author === true             → collapse
//   2. groupConsecutiveCollapsed — flat な (root-level) comments を走査して
//      連続する collapse 対象を 1 グループにまとめる。1 件単体の collapse は
//      "group { count: 1 }" として出さず "single" のままにする。
//
// 純関数 — supabase / RN を一切 import しない。unit test 容易。
// ============================================================

// collapse 判定の閾値。意図的に外に出し、テストや UI で参照できるようにする。
export const COLLAPSE_CONCERN_THRESHOLD = 3;       // 3 人以上が気になる → 折りたたみ
export const COLLAPSE_SCORE_THRESHOLD = -2;        // likes - concerns <= -2 → 折りたたみ
export const COLLAPSE_GROUP_MIN = 2;               // 連続 N 件以上で「まとめ表示」する

// 判定で参照する最小構造。Comment 型に追加カラムが入った後でも参照側は
// fields-required 不変なので、外部から渡しやすい構造体として宣言する。
// types/models.ts は touch しない方針 (他 agent 並列作業中) なので、
// ここに extension 型を定義して呼出側で cast して使う。
export type CommentCollapseInput = {
  concern_count?: number;
  likes_count?: number;
  is_hidden_by_author?: boolean;
};

/**
 * 1 件の comment が「自動 collapse 対象」か判定する。
 *
 * - concern_count >= COLLAPSE_CONCERN_THRESHOLD なら collapse
 * - (likes_count ?? 0) - (concern_count ?? 0) <= COLLAPSE_SCORE_THRESHOLD なら collapse
 * - is_hidden_by_author === true なら collapse
 *
 * 上記いずれかが true なら true を返す。引数の他フィールドは無視。
 */
export function shouldCollapseComment(c: CommentCollapseInput): boolean {
  const concern = typeof c.concern_count === 'number' && Number.isFinite(c.concern_count)
    ? Math.max(0, c.concern_count)
    : 0;
  const likes = typeof c.likes_count === 'number' && Number.isFinite(c.likes_count)
    ? Math.max(0, c.likes_count)
    : 0;

  if (concern >= COLLAPSE_CONCERN_THRESHOLD) return true;
  if (likes - concern <= COLLAPSE_SCORE_THRESHOLD) return true;
  if (c.is_hidden_by_author === true) return true;
  return false;
}

// グループ化結果の判別 union。kind === 'single' は単体表示、
// kind === 'group' は「N 件の低評価コメントを表示」のまとめ。
export type CollapseGroupItem<T> =
  | { kind: 'single'; comment: T }
  | { kind: 'group'; comments: T[]; count: number };

/**
 * 連続する collapse 対象 comment を 1 グループにまとめる。
 *
 * - `collapsed` プロパティが true な comment が「連続」していたらグループ化する
 * - 連続 N 件未満 (= 1 件単体) のときは grouping せず single として返す
 *   (1 件だけのために「1 件の低評価コメントを表示」と出すと UX 上煩い)
 * - 入力配列は mutate しない (純関数)
 *
 * 型は呼出側で `{ id, collapsed }` を最低限持つよう要求。
 */
export function groupConsecutiveCollapsed<T extends { id: string; collapsed?: boolean }>(
  comments: readonly T[],
): CollapseGroupItem<T>[] {
  if (!comments || comments.length === 0) return [];

  const out: CollapseGroupItem<T>[] = [];
  // 走査中の collapse run (連続して collapse な item を貯める bucket)。
  let run: T[] = [];

  // 貯まった run を一括 flush。長さで group/single を切り替える。
  const flushRun = () => {
    if (run.length === 0) return;
    if (run.length < COLLAPSE_GROUP_MIN) {
      // 連続 1 件のみ → group 化せず single で出す
      for (const c of run) out.push({ kind: 'single', comment: c });
    } else {
      out.push({ kind: 'group', comments: run.slice(), count: run.length });
    }
    run = [];
  };

  for (const c of comments) {
    if (c.collapsed) {
      run.push(c);
    } else {
      flushRun();
      out.push({ kind: 'single', comment: c });
    }
  }
  // ループ終端で run が残っていれば flush
  flushRun();

  return out;
}

/**
 * 便利 helper: 既存 Comment[] を walk して `collapsed` プロパティを付加する。
 *
 * 呼出側で {comment, collapsed: shouldCollapseComment(comment)} を毎回作るの
 * を簡略化するための薄いラッパ。引数の comment は mutate しない。
 */
export function annotateCollapsed<T extends CommentCollapseInput & { id: string }>(
  comments: readonly T[],
): Array<T & { collapsed: boolean }> {
  return comments.map((c) => ({
    ...c,
    collapsed: shouldCollapseComment(c),
  }));
}
