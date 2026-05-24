// ============================================================
// lib/cacheUpdates/feedPagePatcher.ts
// ------------------------------------------------------------
// useFeedPage (RPC 経路) の cache を post 単位で patch する共通 helper。
//
// なぜ必要か:
//   feed.tsx は AnonPostCard へ渡す liked / concerned / saved / reactions /
//   likes_count / concern_count を **RPC cache** (= [FEED_PAGE_KEY, userId, sortedKey])
//   の中の FeedPagePost から優先的に読む。
//
//   旧 useLike / useConcern / useSave / useReactions の optimistic update は
//   それぞれの **legacy cache key** (['my-likes'] / ['my-concerns'] / ['my-saves'] /
//   ['reactions']) しか更新していなかった。RPC 経路が active のときは UI には
//   一切反映されず、「クリックしても反応しない」現象が発生する。
//
//   この helper はすべての feed-page cache 候補 (複数 user / 複数 page の
//   並走) を列挙し、対象 post を patch して exact-key で書き戻す。
//   react-query v5 の partial-match setQueriesData が散発的に伝播しない
//   issue を回避するため、必ず exact key + setQueryData を使う。
// ============================================================

import type { QueryClient } from '@tanstack/react-query';
import type { FeedPagePost } from '../api/feedPage';

export const FEED_PAGE_KEY = 'feed-page';

// 部分 patch の型 — FeedPagePost の任意キー。likes_count などの数値は
// FeedPagePost が継承している Post 型に含まれるので、Post & 追加 fields の
// 全部を patch 可能にする。
type FeedPagePatch =
  | Partial<FeedPagePost>
  | ((post: FeedPagePost) => FeedPagePost);

/**
 * すべての feed-page cache を列挙し、postId に一致する row を patch する。
 *
 * - 引数 patch が function なら post を受けて新 post を返す (immutable)。
 * - object なら shallow merge ({ ...old, ...patch })。
 *
 * 内部では:
 *   1. getQueriesData で [FEED_PAGE_KEY] prefix にマッチする exact key 一覧を取得
 *   2. 各 cache が array (= FeedPagePost[]) のときだけ走査
 *   3. postId に一致した row を patch → 別 reference の新配列を setQueryData で書き戻し
 *
 * 同 postId が複数 cache (例: home feed と post detail) に存在する場合は全部更新。
 */
export function patchFeedPagePost(
  qc: QueryClient,
  postId: string,
  patch: FeedPagePatch,
): void {
  const entries = qc.getQueriesData<FeedPagePost[] | undefined>({
    queryKey: [FEED_PAGE_KEY],
  });
  for (const [exactKey, rows] of entries) {
    if (!Array.isArray(rows)) continue;
    let touched = false;
    const next = rows.map((p) => {
      if (p.id !== postId) return p;
      touched = true;
      return typeof patch === 'function' ? patch(p) : { ...p, ...patch };
    });
    if (touched) qc.setQueryData(exactKey, next);
  }
}

/**
 * snapshot を取って失敗時に巻き戻すための helper。
 * onMutate で呼んで戻り値を ctx として保存、onError で `revertFeedPageSnapshot(qc, snap)` する。
 */
export function snapshotFeedPage(
  qc: QueryClient,
): Array<[readonly unknown[], FeedPagePost[] | undefined]> {
  return qc.getQueriesData<FeedPagePost[] | undefined>({
    queryKey: [FEED_PAGE_KEY],
  }) as Array<[readonly unknown[], FeedPagePost[] | undefined]>;
}

export function revertFeedPageSnapshot(
  qc: QueryClient,
  snap: Array<[readonly unknown[], FeedPagePost[] | undefined]>,
): void {
  for (const [key, data] of snap) qc.setQueryData(key, data);
}

/**
 * onSettled で全 feed-page cache を invalidate する shortcut。
 * refetchType: 'active' で mount 中の query は staleTime に関係なく refetch される。
 */
export function invalidateFeedPage(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: [FEED_PAGE_KEY], refetchType: 'active' });
}
