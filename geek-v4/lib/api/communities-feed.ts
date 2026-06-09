// ============================================================
// lib/api/communities-feed.ts — コミュニティフィード API
// ------------------------------------------------------------
// communities.ts から分割。自分が所属するコミュニティの投稿フィード取得に
// 特化した関数群:
//   - fetchMyCommunities          : 所属コミュ一覧 (Community[])
//   - fetchMyCommunitiesWithRole  : 所属コミュ + role 付き (HomeDrawer 用)
//   - fetchMyCommunityFeed        : CommunityPostWithCommunity[] フィード
//   - fetchMyCommunityPostsRich   : Post[] + communityByPost map フィード (AnonPostCard 互換)
//   ↑ 内部ヘルパ: fetchMyCommunityPostsRichLegacy (RPC フォールバック)
//
// Post 型のインポートはこのモジュールで完結させる (旧 communities.ts は 1197 行目に
// mid-file import があって規約違反だった)。
// ============================================================

import { supabase } from '../supabase';
import type { Post } from '../../types/models';
import type { Community, CommunityPostWithCommunity, MemberRole } from './communities-core';

// ============================================================
// 自分の所属コミュニティを role 付きで取得 (HomeDrawer / admin filter 用)
// ------------------------------------------------------------
// `fetchMyCommunities` は community 配列のみで role を捨てるため、
// HomeDrawer の「管理コミュ / 参加コミュ」分割には不向き。
// 本関数は community_members の role を一緒に取得して呼び出し側で
// owner/admin/moderator を分離できるようにする。
//
// 注意:
//   - community_members.role の DB 値は 'owner' | 'admin' | 'member' のみ。
//     'moderator' は将来拡張用に MemberRole 型と並べて受け取る (現状未使用)。
//   - `communities.created_by === user.id` の owner も保険として role='owner' 扱い。
// ============================================================
export type CommunityWithRole = Community & {
  /** community_members.role (自分の役割) */
  role: MemberRole | 'moderator' | null;
};

/** コミュニティフィードで post に紐付けるコミュニティの軽量メタ型 */
export type CommunityMetaLite = {
  id: string;
  name: string;
  icon_emoji: string;
  icon_color: string;
  icon_url: string | null;
  is_official: boolean;
};

// DoS 防止: 1 ユーザーが所属できるコミュ数の現実上限は数十程度なので、
// 100 件で打ち切る。それを超える場合は将来 cursor を追加する。
const FETCH_MY_COMMUNITIES_LIMIT = 100;

/**
 * 自分の所属コミュニティを role 付きで取得する。HomeDrawer の owner/admin 分離に使う。
 * @returns CommunityWithRole[] (joined_at desc)
 */
export async function fetchMyCommunitiesWithRole(): Promise<CommunityWithRole[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('community_members')
    .select('role, community_id, communities!inner(*)')
    .eq('user_id', user.id)
    .order('joined_at', { ascending: false })
    .limit(FETCH_MY_COMMUNITIES_LIMIT);

  if (error) {
    console.warn('[communities] fetchMyCommunitiesWithRole failed:', error.message);
    return [];
  }
  // Supabase embed の型 narrowing が one-to-many と判定するので unknown 経由で正規化
  const rows = (data ?? []) as unknown as Array<{
    role: MemberRole | 'moderator' | null;
    community_id: string;
    communities: Community | Community[] | null;
  }>;
  const out: CommunityWithRole[] = [];
  for (const r of rows) {
    if (!r.communities) continue;
    const community = Array.isArray(r.communities) ? r.communities[0] : r.communities;
    if (!community) continue;
    // created_by が自分なら role='owner' で上書き (RLS の race / 古い insert 漏れ保険)
    const effectiveRole: CommunityWithRole['role'] =
      community.created_by === user.id ? 'owner' : (r.role ?? null);
    out.push({ ...community, role: effectiveRole });
  }
  return out;
}

/**
 * 自分の所属コミュニティ一覧を返す (role 不要な場合に使う軽量版)。
 * @returns Community[] (joined_at desc)
 */
export async function fetchMyCommunities(): Promise<Community[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  // community_members 経由で join — joined_at desc
  const { data, error } = await supabase
    .from('community_members')
    .select('community_id, communities!inner(*)')
    .eq('user_id', user.id)
    .order('joined_at', { ascending: false })
    .limit(FETCH_MY_COMMUNITIES_LIMIT);

  if (error) {
    console.warn('[communities] fetchMyCommunities failed:', error.message);
    return [];
  }
  // Supabase embed の型 narrowing が one-to-many と判定するので unknown 経由で正規化
  const rows = (data ?? []) as unknown as Array<{ community_id: string; communities: Community | Community[] | null }>;
  const out: Community[] = [];
  for (const r of rows) {
    if (!r.communities) continue;
    if (Array.isArray(r.communities)) {
      const first = r.communities[0];
      if (first) out.push(first);
    } else {
      out.push(r.communities);
    }
  }
  return out;
}

// ============================================================
// 所属コミュニティの最新投稿フィード (コミュニティタブのホーム)
// ============================================================
// 重要: 投稿の実体は `posts` テーブルにあり、コミュニティへの紐付けは
// `post_communities` 中間テーブル (migration 0023) を通じて行われる。
// 旧実装は使われていない `community_posts` テーブルを読みに行っていたため
// 「登録コミュニティの投稿が見られない」という致命バグになっていた。
//
// 流れ:
//   1. 自分の community_id 一覧を取得
//   2. post_communities 中間テーブルから post_id を逆引き
//   3. posts 本体 + communities メタを一括取得
//   4. CommunityPostWithCommunity の旧 shape (body / image_url) に正規化
// ============================================================
/**
 * 所属コミュニティの最新投稿を CommunityPostWithCommunity[] で返す。
 * useObsidian など旧型式を参照している呼び出し元向け。
 * @param limit  最大件数 (default 30)
 */
export async function fetchMyCommunityFeed(limit = 30): Promise<CommunityPostWithCommunity[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  // ----- 1) 自分の所属 community_id を取得 -----
  const { data: memberRows, error: memErr } = await supabase
    .from('community_members')
    .select('community_id')
    .eq('user_id', user.id);
  if (memErr || !memberRows || memberRows.length === 0) return [];
  const myCommunityIds = memberRows.map((r) => r.community_id);

  // ----- 2) post_communities から post_id を取得 (新しい attach 順) -----
  // overfetch して post 重複 (同一 post が複数コミュに attach されている場合) を
  // de-dup した後でも limit 件残るようにする
  const overfetch = Math.max(limit * 2, 60);
  const { data: pcRows, error: pcErr } = await supabase
    .from('post_communities')
    .select('post_id, community_id, created_at')
    .in('community_id', myCommunityIds)
    .order('created_at', { ascending: false })
    .limit(overfetch);
  if (pcErr) {
    console.warn('[communities] fetchMyCommunityFeed (post_communities) failed:', pcErr.message);
    return [];
  }
  const pc = pcRows ?? [];
  if (pc.length === 0) return [];

  // post_id 重複削除 — 最も新しい attach の community を採用
  const postToCommunity = new Map<string, string>();
  const postAttachOrder: string[] = [];
  for (const row of pc) {
    if (!postToCommunity.has(row.post_id)) {
      postToCommunity.set(row.post_id, row.community_id);
      postAttachOrder.push(row.post_id);
    }
  }
  const postIds = postAttachOrder.slice(0, limit);

  // ----- 3) posts 本体を取得 -----
  const { data: postRows, error: postErr } = await supabase
    .from('posts')
    .select('id, author_id, content, media_urls, tag_names, visibility, created_at, likes_count, comments_count, is_anonymous')
    .in('id', postIds);
  if (postErr) {
    console.warn('[communities] fetchMyCommunityFeed (posts) failed:', postErr.message);
    return [];
  }
  const posts = postRows ?? [];

  // ----- 4) コミュニティメタを取得 (icon / 公式情報含む) -----
  const usedCommunityIds = Array.from(new Set(posts.map((p) => postToCommunity.get(p.id)).filter(Boolean) as string[]));
  let communityMap: Record<string, Community & {
    official_admin_user_id?: string | null;
    official_admin_display_name?: string | null;
    official_organization?: string | null;
  }> = {};
  if (usedCommunityIds.length > 0) {
    const { data: commRows } = await supabase
      .from('communities')
      .select('id, name, icon_emoji, icon_color, icon_url, is_official, official_admin_user_id, official_admin_display_name, official_organization, description, visibility, member_count, post_count, last_post_at, created_by, created_at')
      .in('id', usedCommunityIds);
    communityMap = Object.fromEntries(
      ((commRows ?? []) as (Community & {
        official_admin_user_id?: string | null;
        official_admin_display_name?: string | null;
        official_organization?: string | null;
      })[]).map((c) => [c.id, c]),
    );
  }

  // ----- 5) author の nickname を一括取得 -----
  const authorIds = Array.from(new Set(posts.map((p) => p.author_id)));
  let nickMap: Record<string, string> = {};
  if (authorIds.length > 0) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, nickname')
      .in('id', authorIds);
    nickMap = Object.fromEntries((profs ?? []).map((p) => [p.id, p.nickname]));
  }

  // ----- 6) attach 時刻順 (postAttachOrder) を維持して CommunityPostWithCommunity に変換 -----
  // 監査指摘: 旧実装は posts.find() を postIds.length 回呼んでいて O(N×M)。
  // limit=40 程度なら無視できるが、将来 limit を増やすと latency に響く。
  const postById = new Map(posts.map((p) => [p.id, p]));
  const result: CommunityPostWithCommunity[] = [];
  for (const postId of postIds) {
    const p = postById.get(postId);
    if (!p) continue;
    const communityId = postToCommunity.get(postId);
    const c = communityId ? communityMap[communityId] : undefined;

    // 公式管理者の投稿は de-anonymize
    let official_author: { name: string; organization: string } | null = null;
    if (c && c.is_official && c.official_admin_user_id && p.author_id === c.official_admin_user_id) {
      official_author = {
        name: c.official_admin_display_name ?? '',
        organization: c.official_organization ?? '',
      };
    }

    const trimmedCommunity = c
      ? {
          id: c.id,
          name: c.name,
          icon_emoji: c.icon_emoji,
          icon_color: c.icon_color,
          icon_url: c.icon_url,
          is_official: c.is_official,
        }
      : null;

    result.push({
      id: p.id,
      community_id: communityId ?? '',
      author_id: p.author_id,
      // posts.content / media_urls を旧 shape (body / image_url) に正規化
      body: p.content ?? '',
      image_url: Array.isArray(p.media_urls) && p.media_urls.length > 0 ? p.media_urls[0] : null,
      created_at: p.created_at,
      community: trimmedCommunity as CommunityPostWithCommunity['community'],
      author_nickname: p.is_anonymous ? undefined : nickMap[p.author_id],
      official_author,
    });
  }
  return result;
}

// ============================================================
// 所属コミュニティの最新投稿フィード (Post[] バージョン)
// ============================================================
// AnonPostCard と互換性のある Post[] と、各 post → community メタの map を返す。
// コミュタブのトップで「コミュ詳細と同じ表示密度」で投稿を見るために使う。
// 旧 fetchMyCommunityFeed (CommunityPostWithCommunity[]) は useObsidian など
// 既存利用が残っているので保留。
// ============================================================

/**
 * AnonPostCard 互換の Post[] と communityByPost マップを返す高機能フィード。
 * 内部で get_community_feed RPC (migration 0042) を使い、失敗時は 4 連クエリに
 * フォールバックする。
 * @param limit  最大件数 (default 40)
 */
export async function fetchMyCommunityPostsRich(
  limit = 40,
): Promise<{ posts: Post[]; communityByPost: Record<string, CommunityMetaLite> }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { posts: [], communityByPost: {} };

  // ----- 高速パス: 1 RPC で全部取得 (migration 0042) -----
  // get_community_feed は SECURITY DEFINER + STABLE で、
  //   - my community_ids → post_communities → posts → communities + profiles
  //   を 1 ラウンドトリップで返す。
  // 旧 4 連 query (p50 ~800ms) → 1 RPC (p50 ~150ms) を目標に最適化。
  try {
    const { data, error } = await supabase.rpc('get_community_feed', {
      p_user_id: user.id,
      p_limit: limit,
    });
    if (error) throw error;

    // RPC return shape:
    // { posts: [ { ...post_cols, community_id, author_nickname, official_author }, ... ] }
    type RpcPostRow = Post & {
      community_id: string | null;
      author_nickname?: string | null;
      official_author?: { name: string; organization: string } | null;
      // 0112: RPC が community 表示メタを inline で返す (未適用 DB では undefined)
      community?: CommunityMetaLite | null;
    };
    const payload = (data ?? { posts: [] }) as { posts?: RpcPostRow[] };
    const rpcPosts = Array.isArray(payload.posts) ? payload.posts : [];

    if (rpcPosts.length === 0) return { posts: [], communityByPost: {} };

    // community メタの解決:
    //   - 0112 適用済: RPC が per-post 'community' を inline 返却 → 追加 query 不要 (1 RTT)。
    //   - 未適用: 従来どおり communities を 1 回だけ .in() で引く (fallback)。
    const communityByPost: Record<string, CommunityMetaLite> = {};
    const hasInlineMeta = rpcPosts.some((p) => p.community);
    if (hasInlineMeta) {
      for (const p of rpcPosts) {
        if (p.community && p.community.id) communityByPost[p.id] = p.community;
      }
    } else {
      const usedCommunityIds = Array.from(
        new Set(
          rpcPosts
            .map((p) => p.community_id)
            .filter((id): id is string => typeof id === 'string' && id.length > 0),
        ),
      );
      if (usedCommunityIds.length > 0) {
        const { data: commRows } = await supabase
          .from('communities')
          .select('id, name, icon_emoji, icon_color, icon_url, is_official')
          .in('id', usedCommunityIds);
        const commMap = new Map(
          ((commRows ?? []) as CommunityMetaLite[]).map((c) => [c.id, c]),
        );
        for (const p of rpcPosts) {
          const cid = p.community_id;
          const c = cid ? commMap.get(cid) : undefined;
          if (c) communityByPost[p.id] = c;
        }
      }
    }

    // RPC が直接返している community_id / author_nickname / official_author は
    // Post 型に乗っていない補助フィールドなので、Post 部分だけを取り出して返す。
    // (UI 側は communityByPost / post.official_author のみを参照する)
    // ★ de-anon Phase2: 投稿者アイデンティティ表示用 (avatar_url / avatar_emoji /
    //   pseudonym_id) も明示的に Post へ載せて、コミュニティタブのカードでも
    //   author_id 非依存で投稿者を主役表示できるようにする (既定 null)。
    const posts: Post[] = rpcPosts.map((p) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { community_id: _cid, author_nickname: _nick, community: _comm, ...rest } = p;
      return {
        ...(rest as Post),
        avatar_url: p.avatar_url ?? null,
        avatar_emoji: p.avatar_emoji ?? null,
        pseudonym_id: p.pseudonym_id ?? null,
      };
    });

    return { posts, communityByPost };
  } catch (rpcErr) {
    // RPC が無い / 失敗した時のフォールバック (旧 4 連 query 実装)
    // migration 0042 が未適用な環境 (CI / 古いプレビュー) でも壊れないように。
    console.warn(
      '[communities] get_community_feed RPC failed, falling back to 4-query path:',
      rpcErr instanceof Error ? rpcErr.message : String(rpcErr),
    );
    return fetchMyCommunityPostsRichLegacy(user.id, limit);
  }
}

// ============================================================
// レガシー 4 連 query 実装 — RPC が未適用 / 失敗時のフォールバック
// ============================================================
async function fetchMyCommunityPostsRichLegacy(
  userId: string,
  limit: number,
): Promise<{ posts: Post[]; communityByPost: Record<string, CommunityMetaLite> }> {
  // 1) 所属 community_id 一覧
  const { data: memberRows, error: memErr } = await supabase
    .from('community_members')
    .select('community_id')
    .eq('user_id', userId);
  if (memErr || !memberRows || memberRows.length === 0) {
    return { posts: [], communityByPost: {} };
  }
  const myCommunityIds = memberRows.map((r) => r.community_id);

  // 2) post_communities 中間テーブルから post_id を新しい attach 順で取得
  const overfetch = Math.max(limit * 2, 60);
  const { data: pcRows, error: pcErr } = await supabase
    .from('post_communities')
    .select('post_id, community_id, created_at')
    .in('community_id', myCommunityIds)
    .order('created_at', { ascending: false })
    .limit(overfetch);
  if (pcErr) {
    console.warn('[communities] fetchMyCommunityPostsRichLegacy (pc) failed:', pcErr.message);
    return { posts: [], communityByPost: {} };
  }
  const pc = pcRows ?? [];
  if (pc.length === 0) return { posts: [], communityByPost: {} };

  // 重複削除 (同一 post が複数コミュに attach されている場合は最新の attach を採用)
  const postToCommunity = new Map<string, string>();
  const order: string[] = [];
  for (const row of pc) {
    if (!postToCommunity.has(row.post_id)) {
      postToCommunity.set(row.post_id, row.community_id);
      order.push(row.post_id);
    }
  }
  const postIds = order.slice(0, limit);

  // 3) posts を AnonPostCard 互換の完全な列セットで取得
  // ★ 動画3列 (video_urls / video_durations / video_posters) を必ず含める。これが
  //   抜けていると、RPC (get_community_feed) が失敗してこの legacy 経路に落ちたとき、
  //   コミュニティの投稿で動画が一切表示されなくなる (bug fix)。
  const POSTS_SELECT_COLS =
    'id, content, media_urls, media_blurhashes, video_urls, video_durations, video_posters, tag_names, likes_count, comments_count, score, hot_score, concern_count, kind, source_url, is_public, trust_score_at_post, is_anonymous, content_warning, cw_category, visibility, created_at, author_id';
  const { data: postRows, error: postErr } = await supabase
    .from('posts')
    .select(POSTS_SELECT_COLS)
    .in('id', postIds);
  if (postErr) {
    console.warn('[communities] fetchMyCommunityPostsRichLegacy (posts) failed:', postErr.message);
    return { posts: [], communityByPost: {} };
  }
  // attach 時刻順に並べる (Map で O(N) lookup)
  const byId = new Map((postRows ?? []).map((p) => [p.id, p as Post]));
  const ordered: Post[] = [];
  for (const id of postIds) {
    const p = byId.get(id);
    if (p) ordered.push(p);
  }

  // 4) コミュニティメタ (icon / name / 公式判定) を一括取得
  const usedCommunityIds = Array.from(
    new Set(ordered.map((p) => postToCommunity.get(p.id)).filter(Boolean) as string[]),
  );
  const communityByPost: Record<string, CommunityMetaLite> = {};
  if (usedCommunityIds.length > 0) {
    const { data: commRows } = await supabase
      .from('communities')
      .select('id, name, icon_emoji, icon_color, icon_url, is_official')
      .in('id', usedCommunityIds);
    const commMap = new Map(
      ((commRows ?? []) as CommunityMetaLite[]).map((c) => [c.id, c]),
    );
    for (const p of ordered) {
      const cid = postToCommunity.get(p.id);
      const c = cid ? commMap.get(cid) : undefined;
      if (c) communityByPost[p.id] = c;
    }
  }

  return { posts: ordered, communityByPost };
}
