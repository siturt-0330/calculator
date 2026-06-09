// ============================================================
// lib/api/homeFeed.ts — home feed 1ページ目を 1 RTT で集約
// ------------------------------------------------------------
// get_home_feed(p_user_id, p_limit) RPC (migration 0114) を 1 ラウンドトリップで叩き、
// ベース posts + 周辺データ (communities/official_author/my_*/reactions/added_tags/poll)
// + nextCursor を取得する。これで home feed cold open の 3 経路
// (fetchPosts → 確定後 get_feed_page + fetchCommunitiesForPosts) を 1 RTT に短縮する。
//
// ★ 既定 sort (for-you) + 既定 scope (open) の 1ページ目専用。2ページ目以降・別 sort・
//   closed scope は呼び出し側 (useFeed) が現行 fetchPosts 経路へ。
//
// kill-switch: EXPO_PUBLIC_HOME_FEED_RPC === '1' のとき「だけ」有効 (既定 OFF)。
//   ★ コードベース初の『既定 OFF』フラグ。前例 (EXPO_PUBLIC_FEED_PAGE_RPC /
//     EXPO_PUBLIC_DISCOVERY_RPC) は !== '0' で既定 ON だが、本 RPC はコア feed・
//     cursor/cache 契約に触れる高リスクなので符号を反転し、明示的に '1' のときだけ ON。
//   Expo は静的参照のみ inline するため process.env を直接比較する (CLAUDE.md §14)。
//
// 未適用 (PGRST202) / 失敗 / timeout / 0件 のときは null を返し、呼び出し側 (useFeed) が
// 現行 fetchPosts へ完全 fallback する (= migration 未適用・flag OFF でも壊れない)。
// ============================================================
import type { QueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';
import { withApiTimeout } from '../withApiTimeout';
import { stableKeyFor } from '../utils/queryKey';
import {
  normalizeFeedPageRow,
  type FeedPagePost,
  type RpcPostRow,
} from './feedPage';
import type { PostCommunityRef } from './posts';

// ★ '1' のとき「だけ」有効 (既定 OFF)。'' / undefined / '0' / 'true' は全て OFF に倒れる。
export const HOME_FEED_RPC_ENABLED = process.env.EXPO_PUBLIC_HOME_FEED_RPC === '1';

// Value Model 個人化フィード RPC (0141_get_for_you_feed)。
// get_home_feed より優先して呼ばれ、タグ親和性・既読除外・コールドスタートを適用する。
// 独立フラグで段階的ロールアウトが可能。
export const FOR_YOU_FEED_RPC_ENABLED = process.env.EXPO_PUBLIC_FOR_YOU_FEED_RPC === '1';

// cold start 初速優先: 初回ページを 12 件に絞る (旧 30)。get_home_feed の応答 JSON は
// 周辺データ + (現状のシードでは base64 画像) を含み、30 件で ~3.8MB と重く、モバイル
// 初回表示の主ボトルネックだった。12 件で初回 payload を ~⅓ に圧縮する。2 ページ目以降は
// 従来の fetchPosts (cursor) が担うので総取得量は変わらない。
// ※ トレードオフ: client rankFeed の「1ページ目 再ランク母集合」が 30→12 に縮むため、
//   初回の for-you 並びは僅かに変わる (スクロールで後続が追従)。
export const HOME_FEED_FIRST_PAGE_LIMIT = 12;

const HOME_FEED_RPC_TIMEOUT_MS = 8000;

export type HomeFeedFirstPage = {
  posts: FeedPagePost[];
  nextCursor: string | null;
};

type HomeFeedRpcShape = {
  posts?: RpcPostRow[] | null;
  nextCursor?: string | null;
};

/**
 * home feed 1ページ目を get_home_feed RPC で取得。
 * @returns 成功時 { posts (FeedPagePost[]), nextCursor }、flag OFF / 失敗 / timeout / 0件 は null。
 *          null は呼び出し側が「現行 fetchPosts 経路へ fallback せよ」のシグナル。
 */
export async function fetchHomeFeedFirstPage(
  userId: string | null,
): Promise<HomeFeedFirstPage | null> {
  if (!HOME_FEED_RPC_ENABLED) return null;
  try {
    const { data, error } = await withApiTimeout(
      supabase.rpc('get_home_feed', {
        p_user_id: userId,
        p_limit: HOME_FEED_FIRST_PAGE_LIMIT,
      }),
      'homeFeed.get_home_feed',
      HOME_FEED_RPC_TIMEOUT_MS,
    );
    if (error) {
      console.warn('[homeFeed] get_home_feed rpc error, falling back:', error.message);
      return null;
    }
    const payload = (data ?? {}) as HomeFeedRpcShape;
    const rows = Array.isArray(payload.posts) ? payload.posts : [];
    // 0件は「RPC 成功だが候補なし」。安全側に倒して null (= fallback) を返す:
    // 万一 RPC の可視性述語に bug があり過少返却しても、空 feed を見せず現行 fetchPosts が拾う。
    // 真に空の feed (新規ユーザー等) は fallback も空を返すので結果は同じ (+1 RTT のみ)。
    if (rows.length === 0) return null;
    return {
      posts: rows.map(normalizeFeedPageRow),
      nextCursor: payload.nextCursor ?? null,
    };
  } catch (e) {
    console.warn(
      '[homeFeed] get_home_feed threw, falling back:',
      e instanceof Error ? e.message : String(e),
    );
    return null;
  }
}

/**
 * for-you フィード 1ページ目を get_for_you_feed RPC で取得 (Value Model 個人化版)。
 * get_home_feed の上位互換として同一 JSON 形式を返す。
 * @returns 成功時 HomeFeedFirstPage、flag OFF / 失敗 / 0件 は null (呼び出し側が fallback)。
 */
export async function fetchForYouFeedFirstPage(
  userId: string | null,
): Promise<HomeFeedFirstPage | null> {
  if (!FOR_YOU_FEED_RPC_ENABLED) return null;
  try {
    const { data, error } = await withApiTimeout(
      supabase.rpc('get_for_you_feed', {
        p_user_id: userId,
        p_limit: HOME_FEED_FIRST_PAGE_LIMIT,
      }),
      'homeFeed.get_for_you_feed',
      HOME_FEED_RPC_TIMEOUT_MS,
    );
    if (error) {
      console.warn('[homeFeed] get_for_you_feed rpc error, falling back:', error.message);
      return null;
    }
    const payload = (data ?? {}) as HomeFeedRpcShape;
    const rows = Array.isArray(payload.posts) ? payload.posts : [];
    if (rows.length === 0) return null;
    return {
      posts: rows.map(normalizeFeedPageRow),
      nextCursor: payload.nextCursor ?? null,
    };
  } catch (e) {
    console.warn(
      '[homeFeed] get_for_you_feed threw, falling back:',
      e instanceof Error ? e.message : String(e),
    );
    return null;
  }
}

/**
 * get_home_feed の周辺データを既存 cache に seed して、get_feed_page (useFeedPage) と
 * fetchCommunitiesForPosts (useFeed の communitiesQ) の二重 fetch を抑止する (cache 戦略 B)。
 *
 * - ['feed-page', userId??'anon', stableKeyFor(ids.sort())] ← FeedPagePost[] (useFeedPage と同形)
 * - ['feed-post-communities', ids.join('|')]                ← Record<id, PostCommunityRef[]>
 *
 * いずれも非破壊 seed ((prev) => prev ?? seeded): 既に新しい値が入っていれば上書きしない。
 * staleTime 内 (feed-page 30s / communities 60s) は cache hit (fresh) で下流の RPC が走らない。
 * blocked タグで表示 set が縮む等で key が一致しない場合は seed が当たらず、useFeedPage が
 * 通常どおり get_feed_page を引くだけ (= 無害な fallback、回帰しない)。
 */
export function seedHomeFeedSurroundingCaches(
  qc: QueryClient,
  userId: string | null,
  posts: FeedPagePost[],
): void {
  if (posts.length === 0) return;
  const ids = posts.map((p) => p.id);

  // 周辺データ (['feed-page'] cache) — useFeedPage.ts:67 と同一 key 形
  const feedPageKey = ['feed-page', userId ?? 'anon', stableKeyFor(ids.slice().sort())];
  qc.setQueryData<FeedPagePost[]>(feedPageKey, (prev) => prev ?? posts);

  // communities (['feed-post-communities'] cache) — useFeed.ts の postIdsHash と同一 key 形
  const communitiesKey = ['feed-post-communities', ids.join('|')];
  qc.setQueryData<Record<string, PostCommunityRef[]>>(communitiesKey, (prev) => {
    if (prev) return prev;
    const rec: Record<string, PostCommunityRef[]> = {};
    for (const p of posts) rec[p.id] = p.communities;
    return rec;
  });
}
