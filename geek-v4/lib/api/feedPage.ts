// ============================================================
// lib/api/feedPage.ts
// ------------------------------------------------------------
// フィードの「1 ページ分」表示に必要な周辺データ
// (communities / official_author / my_like|concern|save / reactions /
//  added_tags / poll) を 1 RPC ラウンドトリップで取得する。
//
// 旧パス: useLikes / useConcerns / useSaves / useReactions / useAddedTags /
//         usePolls / communitiesByPost を並列発射 (7 リクエスト)
// 新パス: supabase.rpc('get_feed_page', { p_post_ids, p_user_id })
//
// migration 0041_get_feed_page_rpc.sql で定義された RPC を呼ぶ。
// RPC が未適用 / 失敗した場合は空配列を返し、呼び出し側 (useFeedPage)
// で旧 hook 群へフォールバックする ENV flag を使う設計。
// ============================================================
import { supabase } from '../supabase';
import { withApiTimeout } from '../withApiTimeout';
import type { Post } from '../../types/models';
import type { PostCommunityRef } from './posts';
import type { ReactionAgg } from './reactions';
import type { Poll, PollOption } from './polls';

// UUID 形式チェック (壊れた URL や古い ID 対策)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// RPC は 11 CTE で動くため、入力が異常に多いと plan 時間が膨らむ。
// クライアント側で先に cap (= サーバー側 raise より前に弾く) ことで:
//   - 1 RPC 呼出のコストを bounded に
//   - 「無限スクロールで postIds が 500 件溜まった」みたいなケースで hang しない
//   - 0071 migration の array_length チェックと整合 (cap = 100)
const MAX_POST_IDS_PER_CALL = 100;

// RPC が応答しない (or 重い) 時に UI を hang させない timeout。
// 通常 200-600ms で完了する想定なので 8s で十分。
const FEED_PAGE_RPC_TIMEOUT_MS = 8000;

// RPC 1 件の戻り値型
export type FeedPagePost = Post & {
  communities: PostCommunityRef[];
  official_author: { name: string; organization: string } | null;
  my_like: boolean;
  my_concern: boolean;
  my_save: boolean;
  reactions: ReactionAgg[];
  added_tags: string[];
  poll: Poll | null;
  // de-anon Phase2: server が author_id をマスクして返す代わりに「自分の投稿か」を
  //   boolean で供給する (viewer 相対なので my_like 等と同じ FeedPagePost 側に置く)。
  is_own: boolean;
  // de-anon Phase2: 投稿者アイデンティティ表示用 (author_id 非依存)。row から拾って既定 null。
  avatar_url: string | null;
  avatar_emoji: string | null;
  pseudonym_id: string | null;
};

// RPC の生 row shape (server 側 json_build_object と一致)
// poll は server 側で post_id が無いので、クライアントで補完する。
type RpcReactionRow = { meme: string; count: number; mine: boolean };
type RpcCommunityRow = {
  community_id: string;
  name: string;
  icon_emoji: string;
  icon_url: string | null;
  is_official: boolean;
};
type RpcPollRow = {
  id: string;
  question: string;
  expires_at: string | null;
  multi_select: boolean;
  total_votes: number;
  options: Array<{ id: string; label: string; vote_count: number }>;
  my_vote_option_ids: string[];
};
export type RpcPostRow = Post & {
  communities?: RpcCommunityRow[] | null;
  official_author?: { name: string; organization: string } | null;
  my_like?: boolean | null;
  my_concern?: boolean | null;
  my_save?: boolean | null;
  reactions?: RpcReactionRow[] | null;
  added_tags?: string[] | null;
  poll?: RpcPollRow | null;
  is_own?: boolean | null;
  avatar_url?: string | null;
  avatar_emoji?: string | null;
  pseudonym_id?: string | null;
};

/**
 * フィードの 1 ページ分の周辺データを 1 RPC で取得。
 *
 * @param postIds 取得対象の post id 配列。順序は保たれる (RPC 側で ordinality 維持)
 * @param userId  自分の uid (my_* 判定用)。未指定なら全て false 扱い
 * @returns       FeedPagePost[] — postIds 順
 *
 * UUID 不正は事前に弾く (URL 長さ削減 + RPC エラー回避)。
 * RPC エラー時は console.warn + 空配列。呼び出し側で旧 hook 群へフォールバック可能。
 */
export async function fetchFeedPage(
  postIds: string[],
  userId?: string | null,
): Promise<FeedPagePost[]> {
  if (!Array.isArray(postIds) || postIds.length === 0) return [];

  // UUID 検証 — 不正な ID は除外 (重複 ID も dedup)
  const seen = new Set<string>();
  const validIds: string[] = [];
  for (const id of postIds) {
    if (typeof id !== 'string') continue;
    if (!UUID_RE.test(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    validIds.push(id);
    if (validIds.length >= MAX_POST_IDS_PER_CALL) break;
  }
  if (validIds.length === 0) return [];

  // userId も UUID 検証 (anon は null)
  const safeUserId =
    typeof userId === 'string' && UUID_RE.test(userId) ? userId : null;

  try {
    // withApiTimeout: Supabase RPC は AbortController が無いので race で打ち切る。
    // 8s 経過時に reject されると React Query 側で retry: 1 が走り、それでも失敗なら
    // 上位の useFeedPage が空 Map を返し、feed.tsx は post 本体だけ表示する
    // (= 完全 hang は絶対しない設計)。
    const { data, error } = await withApiTimeout(
      supabase.rpc('get_feed_page', {
        p_post_ids: validIds,
        p_user_id: safeUserId,
      }),
      'feedPage.get_feed_page',
      FEED_PAGE_RPC_TIMEOUT_MS,
    );
    if (error) {
      console.warn('[fetchFeedPage] rpc error:', error.message);
      return [];
    }

    // RPC return shape: { posts: RpcPostRow[] }
    const payload = (data ?? { posts: [] }) as { posts?: RpcPostRow[] };
    const rows = Array.isArray(payload.posts) ? payload.posts : [];

    return rows.map((r) => normalizeFeedPageRow(r));
  } catch (e: unknown) {
    console.warn(
      '[fetchFeedPage] rpc threw:',
      e instanceof Error ? e.message : String(e),
    );
    return [];
  }
}

// ----------------------------------------------------------------
// RpcPostRow → FeedPagePost (型を確実に揃える)
// ★ get_home_feed (0114) も get_feed_page と同一 row shape を返すため、
//   lib/api/homeFeed.ts がこの正規化を再利用して ['feed-page'] cache の
//   FeedPagePost shape を厳密一致させる (seed しても patcher/realtime と互換)。
// ----------------------------------------------------------------
export function normalizeFeedPageRow(r: RpcPostRow): FeedPagePost {
  const communities: PostCommunityRef[] = Array.isArray(r.communities)
    ? r.communities.map((c) => ({
        community_id: c.community_id,
        name: c.name,
        icon_emoji: c.icon_emoji,
        icon_url: c.icon_url ?? null,
        is_official: !!c.is_official,
      }))
    : [];

  const reactions: ReactionAgg[] = Array.isArray(r.reactions)
    ? r.reactions.map((re) => ({
        meme: re.meme,
        count: typeof re.count === 'number' ? re.count : Number(re.count) || 0,
        mine: !!re.mine,
      }))
    : [];

  const added_tags: string[] = Array.isArray(r.added_tags) ? r.added_tags : [];

  let poll: Poll | null = null;
  if (r.poll && typeof r.poll === 'object') {
    const p = r.poll;
    const options: PollOption[] = Array.isArray(p.options)
      ? p.options.map((o, i) => ({
          id: o.id,
          poll_id: p.id,
          label: o.label,
          ordinal: i,
          vote_count: typeof o.vote_count === 'number'
            ? o.vote_count
            : Number(o.vote_count) || 0,
        }))
      : [];
    poll = {
      id: p.id,
      post_id: r.id,
      question: p.question,
      expires_at: p.expires_at ?? null,
      multi_select: !!p.multi_select,
      // server に is_anonymous が無いので true 既定 (作成時の default に揃える)
      is_anonymous: true,
      total_votes:
        typeof p.total_votes === 'number'
          ? p.total_votes
          : Number(p.total_votes) || 0,
      options,
      my_vote_option_ids: Array.isArray(p.my_vote_option_ids)
        ? p.my_vote_option_ids
        : [],
    };
  }

  // RPC が返す Post と同じ列セットを保持。型の安全のため明示的に分解。
  const {
    // RPC 側の追加フィールドを取り除く (Post 型に存在しないため)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    communities: _c,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    official_author: _oa,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    my_like: _ml,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    my_concern: _mc,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    my_save: _ms,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    reactions: _re,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    added_tags: _at,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    poll: _pl,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    is_own: _io,
    // de-anon Phase2: 表示用フィールドは下で明示的に null 既定で再付与する
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    avatar_url: _av,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    avatar_emoji: _ae,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    pseudonym_id: _pid,
    ...post
  } = r;

  const out: FeedPagePost = {
    ...(post as Post),
    communities,
    official_author: r.official_author ?? null,
    my_like: !!r.my_like,
    my_concern: !!r.my_concern,
    my_save: !!r.my_save,
    reactions,
    added_tags,
    poll,
    is_own: !!r.is_own,
    avatar_url: r.avatar_url ?? null,
    avatar_emoji: r.avatar_emoji ?? null,
    pseudonym_id: r.pseudonym_id ?? null,
  };
  return out;
}
