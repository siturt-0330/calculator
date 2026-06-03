import { supabase } from '../supabase';
import { generateVariants } from '../search/variants';
import { findSimilar } from '../search/similarity';
import { sanitizeText } from '../sanitize';

export type Visibility = 'open' | 'request' | 'invite';
export type MemberRole = 'owner' | 'admin' | 'member';

// ============================================================
// コミュニティ ジャンル (migration 0044) — 機能撤去済み
// ------------------------------------------------------------
// 当初はジャンルごとに詳細画面のタブ構成を切替える設計だったが、
// ジャンル別タブ / 作成時のジャンル選択 UI は撤去 (ユーザー要望)。
// DB column communities.genre は migration 0044 で追加済み・
// default 'legacy' で残置 (既存データ保持のため drop はしない)。
// 型は Community.genre が DB を反映するためだけに保持する。
// ============================================================
export type CommunityGenre =
  | 'oshi'
  | 'creative'
  | 'experience'
  | 'discussion'
  | 'legacy';

export type Community = {
  id: string;
  name: string;
  description: string;
  icon_emoji: string;
  icon_color: string;
  icon_url: string | null;
  visibility: Visibility;
  // migration 0044 で追加。default 'legacy' で既存 community も値あり。
  // 表記ゆれで undefined が来ても困らないよう、UI 側でも || 'legacy' で fallback。
  genre: CommunityGenre;
  member_count: number;
  post_count: number;
  last_post_at: string | null;
  created_by: string;
  created_at: string;
  // 公式コミュニティ (migration 0032)
  is_official?: boolean;
  official_admin_user_id?: string | null;
  official_admin_display_name?: string | null;
  official_organization?: string | null;
  official_features?: Array<'qna' | 'calendar' | 'map'>;
};

export type CommunityWithMembership = Community & {
  is_member: boolean;
  role: MemberRole | null;
  /** request 制コミュで、自分の保留中(pending)申請があるか (fetchCommunity が判定) */
  has_pending_request?: boolean;
  tags: string[];
};

export type CommunityPost = {
  id: string;
  community_id: string;
  author_id: string;
  body: string;
  image_url: string | null;
  created_at: string;
};

// ============================================================
// 聖地 (community_spots) — 地図ベース・スポット
// ------------------------------------------------------------
// migration 0045 で category + photo_urls を追加 (wiki 編集解放含む)
// カテゴリ定義は lib/api/spotCategory.ts (RN チェーン非依存 pure module)
// ============================================================

export {
  SPOT_CATEGORY_META,
  SELECTABLE_SPOT_CATEGORIES,
} from './spotCategory';
export type { SpotCategory } from './spotCategory';
import { SELECTABLE_SPOT_CATEGORIES, type SpotCategory } from './spotCategory';

export type CommunitySpot = {
  id: string;
  community_id: string;
  name: string;
  description: string;
  lat: number;
  lon: number;
  // migration 0045 で追加。旧 photo_url (単数) は後方互換のため残す。
  // 表示時は photo_urls.length > 0 ? photo_urls : (photo_url ? [photo_url] : [])
  category: SpotCategory;
  photo_urls: string[];
  photo_url: string | null;
  created_by: string;
  created_at: string;
  is_certified?: boolean;
};

// ============================================================
// カレンダー (community_events) — オフ会 / イベント
// ============================================================
export type CommunityEvent = {
  id: string;
  community_id: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string | null;
  location_text: string | null;
  photo_url: string | null;
  created_by: string;
  created_at: string;
  // migration 0046 で追加。会場 spot との 1:N リンク (1 spot で複数イベント可)。
  // null の場合は location_text のみで運用 (既存イベント互換)。
  spot_id?: string | null;
};

export type CommunityPostWithCommunity = CommunityPost & {
  community: Pick<Community, 'id' | 'name' | 'icon_emoji' | 'icon_color' | 'icon_url' | 'is_official'>;
  author_nickname?: string;
  // 公式コミュ管理者投稿の de-anonymize 用 (匿名ニックネームではなく実名 · 所属を表示)
  official_author?: { name: string; organization: string } | null;
};

// ============================================================
// 自分が参加している全コミュニティの直近イベントを横串で取得
// (マイページ集約カレンダー用 — opt-out はクライアント側で行う想定)
// ============================================================
// 返り値は starts_at 昇順。1 ユーザーで参加コミュ数 × 直近イベントを取るので
// 最大件数を絞る (limit 500 ≒ コミュ数 50 × 各 10 件相当)。
export async function fetchMyUpcomingEvents(opts: {
  limit?: number;
  /** 除外したい community_id (マイページ opt-out 用) */
  excludeCommunityIds?: string[];
} = {}): Promise<Array<CommunityEvent & { community: Pick<Community, 'id' | 'name' | 'icon_emoji' | 'icon_color' | 'icon_url'> }>> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: memberRows, error: memErr } = await supabase
    .from('community_members')
    .select('community_id')
    .eq('user_id', user.id);
  if (memErr || !memberRows || memberRows.length === 0) return [];

  const exclude = new Set(opts.excludeCommunityIds ?? []);
  const myCommunityIds = memberRows
    .map((r) => r.community_id as string)
    .filter((id) => !exclude.has(id));
  if (myCommunityIds.length === 0) return [];

  const limit = Math.max(1, Math.min(opts.limit ?? 200, 500));
  const { data, error } = await supabase
    .from('community_events')
    .select('*, communities!inner(id, name, icon_emoji, icon_color, icon_url)')
    .in('community_id', myCommunityIds)
    .gte('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: true })
    .limit(limit);

  if (error) {
    console.warn('[communities] fetchMyUpcomingEvents failed:', error.message);
    return [];
  }

  // Supabase embed の型 narrowing が one-to-many と判定するので unknown 経由
  type Raw = CommunityEvent & {
    communities?: Pick<Community, 'id' | 'name' | 'icon_emoji' | 'icon_color' | 'icon_url'> | Array<Pick<Community, 'id' | 'name' | 'icon_emoji' | 'icon_color' | 'icon_url'>> | null;
  };
  const rows = (data ?? []) as unknown as Raw[];
  const out: Array<CommunityEvent & { community: Pick<Community, 'id' | 'name' | 'icon_emoji' | 'icon_color' | 'icon_url'> }> = [];
  for (const r of rows) {
    if (!r.communities) continue;
    const community = Array.isArray(r.communities) ? r.communities[0] : r.communities;
    if (!community) continue;
    // communities フィールドを外して community で正規化
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { communities: _communities, ...rest } = r;
    out.push({ ...(rest as CommunityEvent), community });
  }
  return out;
}

// 自分の所属コミュニティを取得 (TopBar 用)
// ============================================================
// DoS 防止: 1 ユーザーが所属できるコミュ数の現実上限は数十程度なので、
// 100 件で打ち切る。それを超える場合は将来 cursor を追加する。
const FETCH_MY_COMMUNITIES_LIMIT = 100;

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
// コミュニティ作成 (タグも同時に登録)
// ============================================================
export async function createCommunity(input: {
  name: string;
  description: string;
  icon_emoji: string;
  icon_color: string;
  icon_url?: string | null;
  visibility: Visibility;
  tags: string[];
}): Promise<{ data: Community | null; error: string | null }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'ログインしてください' };
  // セッションが古いと auth.uid() が PostgREST 側で null になる事故を防ぐ
  await supabase.auth.refreshSession().catch(() => {});

  // 名前 / 説明を sanitize (HTML / script / onerror= / javascript: / 制御文字を除去)
  // 監査修正: コミュ name/description は <Text> でしか表示しないため、
  // sanitizeContent (= trim / on..=削除 / 連続改行圧縮) は副作用が大きすぎる。
  // sanitizeText の "ゆるい" sanitizer で書式を保ったまま危険タグだけ除去。
  const safeName = sanitizeText(input.name, { maxLength: 40 });
  const safeDesc = sanitizeText(input.description, { maxLength: 500 });
  if (safeName.length < 2) {
    return { data: null, error: 'コミュニティ名は 2 文字以上にしてください' };
  }
  // genre は insert payload に含めない (ジャンル機能撤去)。DB column は
  // default 'legacy' なので未指定でも NOT NULL 制約を満たす。
  const basePayload = {
    name: safeName,
    description: safeDesc,
    icon_emoji: input.icon_emoji,
    icon_color: input.icon_color,
    icon_url: input.icon_url ?? null,
    visibility: input.visibility,
    created_by: user.id,
  };

  const { data, error } = await supabase
    .from('communities')
    .insert(basePayload)
    .select()
    .single();

  if (error || !data) {
    const msg = error?.message ?? '';
    if (msg.includes('row-level security') || msg.includes('行レベル')) {
      return { data: null, error: 'ログイン状態が古くなっています。一度ログアウトして入り直すか、しばらく経ってから再試行してください。' };
    }
    return { data: null, error: msg || 'コミュニティ作成に失敗しました' };
  }

  // タグを登録 (失敗しても community 自体は出来ているのでログだけ)
  if (input.tags.length > 0) {
    const cleanTags = input.tags
      .map((t) => t.trim().replace(/^#/, ''))
      .filter((t) => t.length > 0 && t.length <= 40)
      .slice(0, 10);
    if (cleanTags.length > 0) {
      const rows = cleanTags.map((tag) => ({ community_id: data.id, tag }));
      const { error: tagErr } = await supabase.from('community_tags').insert(rows);
      if (tagErr) console.warn('[communities] tag insert failed:', tagErr.message);
    }
  }

  return { data, error: null };
}

// ============================================================
// コミュニティ更新 (owner / admin のみ - icon/name/desc/visibility)
// ============================================================
// 監査指摘: 旧実装は patch を直接 update に投げており、内部 column (member_count
// / created_by / official_*) も書き換え可能だった。RLS / trigger が後段で守るが
// defense-in-depth として API レイヤでもホワイトリスト化。
const COMMUNITY_UPDATE_ALLOWED = [
  'name', 'description', 'icon_emoji', 'icon_color', 'icon_url', 'visibility',
] as const;

export async function updateCommunity(
  id: string,
  patch: Partial<Pick<Community, 'name' | 'description' | 'icon_emoji' | 'icon_color' | 'icon_url' | 'visibility'>>,
): Promise<{ error: string | null }> {
  if (!UUID_RE.test(id)) return { error: '不正なコミュニティ ID です' };

  // ホワイトリスト経由でだけ patch を構築
  const safePatch: Record<string, unknown> = {};
  for (const key of COMMUNITY_UPDATE_ALLOWED) {
    if (key in patch && patch[key] !== undefined) {
      safePatch[key] = patch[key];
    }
  }
  if (Object.keys(safePatch).length === 0) {
    return { error: null }; // no-op
  }

  // name / description は sanitize
  if (typeof safePatch.name === 'string') {
    safePatch.name = sanitizeText(safePatch.name, { maxLength: 40 });
    if ((safePatch.name as string).length < 2) {
      return { error: 'コミュニティ名は 2 文字以上にしてください' };
    }
  }
  if (typeof safePatch.description === 'string') {
    safePatch.description = sanitizeText(safePatch.description, { maxLength: 500 });
  }
  // visibility は ENUM 値のみ
  if (typeof safePatch.visibility === 'string'
      && !['open', 'request', 'invite'].includes(safePatch.visibility as string)) {
    return { error: '不正な公開設定です' };
  }

  const { error } = await supabase.from('communities').update(safePatch).eq('id', id);
  if (error) return { error: mapJoinError(error.message) };
  return { error: null };
}

// ============================================================
// コミュニティタグの一括更新 (wiki edit 用)
// ------------------------------------------------------------
// 既存タグを全削除 → 新タグを insert する単純実装。
// migration 0048 で member 全員が community_tags の INSERT/DELETE 可 (元から)。
//
// 同時編集時の race:
//   - 2 人が同時に変更 → 後勝ち (最後の insert が残る)
//   - Wiki 思想なので許容。将来 audit log + revert で対応。
// ============================================================
export async function replaceCommunityTags(
  community_id: string,
  tags: string[],
): Promise<{ error: string | null }> {
  if (!UUID_RE.test(community_id)) return { error: '不正なコミュニティ ID です' };

  // sanitize (createCommunity と同じルール)
  const cleanTags = tags
    .map((t) => t.trim().replace(/^#/, ''))
    .filter((t) => t.length > 0 && t.length <= 40)
    .slice(0, 10);
  // 重複除外 (PK は (community_id, tag) なので insert で conflict する前に dedupe)
  const uniqueTags = Array.from(new Set(cleanTags));

  // 既存を全削除
  const { error: delErr } = await supabase
    .from('community_tags')
    .delete()
    .eq('community_id', community_id);
  if (delErr) return { error: delErr.message };

  if (uniqueTags.length === 0) return { error: null };

  // 新規 insert
  const rows = uniqueTags.map((tag) => ({ community_id, tag }));
  const { error: insErr } = await supabase.from('community_tags').insert(rows);
  if (insErr) return { error: insErr.message };
  return { error: null };
}

// 共通 UUID 形式チェック (community_id 入力検証)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================================
// コミュニティ詳細を取得 (自分のメンバーシップ含む + タグ)
// ============================================================
export async function fetchCommunity(id: string): Promise<CommunityWithMembership | null> {
  const { data: { user } } = await supabase.auth.getUser();

  const { data: comm, error } = await supabase
    .from('communities')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error || !comm) return null;

  const [tagRes, membRes, reqRes] = await Promise.all([
    supabase.from('community_tags').select('tag').eq('community_id', id),
    user
      ? supabase
          .from('community_members')
          .select('role')
          .eq('community_id', id)
          .eq('user_id', user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // request 制コミュのときだけ、自分の保留中(pending)申請を確認する。
    // RLS (0017) で本人の join_request 行は読めるので、これで「申請中」を反映できる。
    // (旧: members しか見ておらず、申請してもボタンが「申請」のまま=反映されない不具合)
    user && comm.visibility === 'request'
      ? supabase
          .from('community_join_requests')
          .select('status')
          .eq('community_id', id)
          .eq('user_id', user.id)
          .eq('status', 'pending')
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const tags = (tagRes.data ?? []).map((r) => r.tag);
  const role = (membRes.data as { role: MemberRole } | null)?.role ?? null;
  const hasPendingRequest = !!(reqRes.data as { status?: string } | null);

  return {
    ...comm,
    tags,
    is_member: role !== null,
    role,
    has_pending_request: hasPendingRequest,
  };
}

// ============================================================
// 類似名チェック (作成時の重複防止)
// open + request だけ取得 (invite は除外 — 他人に存在を知らせない)
// あとで client side similarity で絞り込む
// ============================================================
export async function searchByName(query: string, limit = 20): Promise<Community[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  // バリエーション生成 (== / イコール / 同義語 etc.) して or-ilike で broad fetch
  // それから client similarity で再ランキング
  // 監査指摘: 旧実装は `%` / `_` をエスケープしておらず、`_` 含みの入力で
  // ilike が全件マッチ化、`%` 入力で構文崩壊する問題があった。
  // searchCommunities と同じ escapeForIlike を共通利用。
  const variants = generateVariants(q).slice(0, 6);
  const orClauses = variants
    .filter((v) => v.length >= 2)
    .map((v) => `name.ilike.%${escapeForIlike(v)}%`);
  // フォールバック: orClauses が空なら q を escape して ilike
  const orQuery = orClauses.length > 0
    ? orClauses.join(',')
    : `name.ilike.%${escapeForIlike(q)}%`;

  const { data, error } = await supabase
    .from('communities')
    .select('*')
    .in('visibility', ['open', 'request'])
    .or(orQuery)
    .limit(80);

  if (error) {
    console.warn('[communities] searchByName failed:', error.message);
    return [];
  }
  const rows = (data ?? []) as Community[];
  // クライアント側で similarity score で再ランキング (近重複だけを上位に)
  const ranked = findSimilar(q, rows, { threshold: 0.4, limit });
  return ranked.map((r) => r.item);
}

// ============================================================
// 公式コミュニティ一覧 — 探す画面の上部セクション用
// is_official = true のものを member_count → created_at の順で返す
// ============================================================
export async function fetchOfficialCommunities(limit = 10): Promise<Community[]> {
  const { data, error } = await supabase
    .from('communities')
    .select('*')
    .eq('is_official', true)
    .order('member_count', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn('[communities] fetchOfficialCommunities failed:', error.message);
    return [];
  }
  return (data ?? []) as Community[];
}

// ============================================================
// 急上昇コミュニティ — 直近に投稿があったコミュを last_post_at 降順で
// ------------------------------------------------------------
// 「いま盛り上がっている」= 直近にアクティビティがあるコミュの近似。
// GEEK には閲覧者数や時系列の成長率が無いため、last_post_at (最終投稿時刻)
// を活性度の proxy として使う。投稿ゼロ (last_post_at が null) は除外。
// member_count 順の「おすすめ」とは別軸で、新しめ・活発なコミュが上に来る。
// invite (完全招待制) は探索面に出さない (open / request のみ)。
// ============================================================
export async function fetchRisingCommunities(limit = 20): Promise<Community[]> {
  const { data, error } = await supabase
    .from('communities')
    .select('*')
    .in('visibility', ['open', 'request'])
    .not('last_post_at', 'is', null)
    .order('last_post_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn('[communities] fetchRisingCommunities failed:', error.message);
    return [];
  }
  return (data ?? []) as Community[];
}

// ============================================================
// コミュニティ検索 (discover) — invite は除外
// variants で「ポケモン / pokemon / ぽけもん / pkmn」等の表記ゆらぎを吸収
//
// 戻り値は Community[] で互換性を保つが、内部では searchCommunities() を呼んで
// matched_by / score 付きの結果を計算し、score 順にソートして返す。
// 詳細メタを使いたい場合は searchCommunities() を直接呼ぶこと。
// ============================================================
export async function discoverCommunities(opts: {
  query?: string;
  tag?: string;
  limit?: number;
}): Promise<Community[]> {
  const hits = await searchCommunities(opts);
  return hits;
}

// ============================================================
// searchCommunities — マッチ理由付きで返す高機能版
// ============================================================
// 改善点 (旧 discoverCommunities 比):
//   1) name と description の両方を検索対象に
//   2) variants は length >= 2 のみ (single char で全件マッチ事故を防ぐ)
//   3) PostgREST or() の文法を破壊する `,` `(` `)` `:` `\` および
//      ilike ワイルドカード `%` `_` を入力からエスケープ
//   4) 結果をクライアント側でスコアリングして再ランキング
//      - name 完全一致: +100
//      - name prefix:   +60
//      - name 含む:     +40
//      - 説明 含む:     +15
//      - synonym 経由:  +5
//      - 公式は微ブースト +5
//      - member_count を log scale で加点 (人気の僅差調整)
//   5) 重複削除 (1 community が複数 OR clause でヒットしうる)
// ============================================================
export type MatchedBy = 'name-exact' | 'name-prefix' | 'name-contains' | 'desc-contains' | 'synonym' | 'popular';

export type CommunityHit = Community & {
  matchedBy: MatchedBy;
  matchedVariant?: string;
  score: number;
};

// PostgREST or() 文法と ilike を破壊する文字をエスケープ
function escapeForIlike(s: string): string {
  return s
    .replace(/\\/g, '\\\\')      // backslash 先
    .replace(/%/g, '\\%')         // ilike wildcard
    .replace(/_/g, '\\_')         // ilike wildcard
    .replace(/[,()]/g, '');       // PostgREST or() の区切り文字を削除
}

export async function searchCommunities(opts: {
  query?: string;
  tag?: string;
  officialOnly?: boolean;
  limit?: number;
}): Promise<CommunityHit[]> {
  const limit = opts.limit ?? 30;
  const queryStr = opts.query?.trim() ?? '';
  const normalizedQuery = queryStr.toLowerCase();

  // tag フィルタ用 community_id を先に取得 (必要なら)
  let tagFilterIds: string[] | null = null;
  if (opts.tag) {
    const { data: tagged } = await supabase
      .from('community_tags')
      .select('community_id')
      .eq('tag', opts.tag);
    tagFilterIds = (tagged ?? []).map((t) => t.community_id);
    if (tagFilterIds.length === 0) return [];
  }

  // クエリ無し → 人気順 (member_count desc) + last_post_at で活性度ブースト
  if (!queryStr) {
    let q = supabase
      .from('communities')
      .select('*')
      .in('visibility', ['open', 'request'])
      .order('member_count', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);
    if (opts.officialOnly) q = q.eq('is_official', true);
    if (tagFilterIds) q = q.in('id', tagFilterIds);
    const { data, error } = await q;
    if (error) {
      console.warn('[communities] searchCommunities (no query) failed:', error.message);
      return [];
    }
    return (data ?? []).map((c) => ({
      ...c,
      matchedBy: 'popular' as MatchedBy,
      score: c.member_count + (c.is_official ? 5 : 0),
    }));
  }

  // バリエーション生成 (length>=2 のみ、特殊文字エスケープ後に重複除外)
  const rawVariants = generateVariants(queryStr).slice(0, 8);
  const variantsSet = new Set<string>();
  for (const v of rawVariants) {
    const trimmed = v.trim();
    if (trimmed.length < 2) continue;
    const esc = escapeForIlike(trimmed);
    if (esc.length >= 2) variantsSet.add(esc);
  }
  // フォールバック: variants 全部 length<2 なら原文をそのまま (1 文字検索を許可)
  if (variantsSet.size === 0) {
    const esc = escapeForIlike(queryStr);
    if (esc.length >= 1) variantsSet.add(esc);
  }
  const escapedVariants = Array.from(variantsSet);

  // name + description の OR
  const orClauses: string[] = [];
  for (const v of escapedVariants) {
    orClauses.push(`name.ilike.%${v}%`);
    orClauses.push(`description.ilike.%${v}%`);
  }

  let q = supabase
    .from('communities')
    .select('*')
    .in('visibility', ['open', 'request'])
    .or(orClauses.join(','))
    .limit(Math.max(limit * 3, 100)); // overfetch して再ランキング
  if (opts.officialOnly) q = q.eq('is_official', true);
  if (tagFilterIds) q = q.in('id', tagFilterIds);

  const { data, error } = await q;
  if (error) {
    console.warn('[communities] searchCommunities failed:', error.message);
    return [];
  }
  const rows = (data ?? []) as Community[];

  // ----- スコアリング -----
  const hits: CommunityHit[] = [];
  const seenIds = new Set<string>();
  for (const c of rows) {
    if (seenIds.has(c.id)) continue;
    const name = (c.name ?? '').toLowerCase();
    const desc = (c.description ?? '').toLowerCase();

    let bestScore = 0;
    let bestMatch: MatchedBy = 'name-contains';
    let matchedVariant: string | undefined;

    // 原文 (= ユーザーが直接入力した文字列) を最優先で評価
    if (name === normalizedQuery) {
      bestScore = 100;
      bestMatch = 'name-exact';
      matchedVariant = queryStr;
    } else if (name.startsWith(normalizedQuery)) {
      bestScore = 60;
      bestMatch = 'name-prefix';
      matchedVariant = queryStr;
    } else if (name.includes(normalizedQuery)) {
      bestScore = 40;
      bestMatch = 'name-contains';
      matchedVariant = queryStr;
    } else if (desc.includes(normalizedQuery)) {
      bestScore = 15;
      bestMatch = 'desc-contains';
      matchedVariant = queryStr;
    } else {
      // 原文ではマッチしないが variants 経由で hit → synonym 扱い
      for (const v of escapedVariants) {
        const lv = v.toLowerCase();
        if (lv === normalizedQuery) continue;
        if (name.includes(lv)) {
          bestScore = 30;
          bestMatch = 'synonym';
          matchedVariant = v;
          break;
        }
        if (desc.includes(lv)) {
          bestScore = 5;
          bestMatch = 'synonym';
          matchedVariant = v;
          break;
        }
      }
      // それでも無ければ DB の OR にはマッチしてるはずなので 1 点
      if (bestScore === 0) {
        bestScore = 1;
        bestMatch = 'synonym';
      }
    }

    // 公式コミュは僅差ブースト
    if (c.is_official) bestScore += 5;
    // メンバー数の log boost (大規模優位を緩和)
    bestScore += Math.log10(Math.max(1, c.member_count));

    hits.push({ ...c, matchedBy: bestMatch, matchedVariant, score: bestScore });
    seenIds.add(c.id);
  }

  // スコア降順、同点ならメンバー数→新しい順
  hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.member_count !== a.member_count) return b.member_count - a.member_count;
    return Date.parse(b.created_at) - Date.parse(a.created_at);
  });

  return hits.slice(0, limit);
}

// ============================================================
// realtime: 自分の community_members 変更を購読
// ============================================================
// ★ Audit E#5 (2026-05-28):
//   旧版は `my-communities:userId` channel で community_members を subscribe して
//   いたが、community_members は **supabase_realtime publication に未登録**
//   (migrations 確認: 0008/0009/0010/0013/0039/0040/0050/0051/0052 いずれにも無い)。
//   CLAUDE.md § 5.3「publication 未登録 table を subscribe しない」に違反する
//   ghost 購読で、CHANNEL_ERROR を立てるだけで実際は何も配信されていなかった。
//
//   → realtime を撤去 (no-op deprecated)。caller (app/(tabs)/community/index.tsx)
//     は `useFocusEffect` での invalidate で鮮度を保つ:
//     - 自分の join/leave は joinCommunity / leaveCommunity の onSuccess で
//       invalidate される
//     - 別端末や別画面での参加変動は focus 復帰時に refetch される
//
//   API signature は維持して call site の修正を最小化。
// ============================================================
export function subscribeToMyCommunityChanges(
  _userId: string,
  _onChange: () => void,
): { unsubscribe: () => void } {
  return {
    unsubscribe: () => {
      /* no-op (deprecated — see comment above) */
    },
  };
}

// ============================================================
// 参加系エラーメッセージのマッピング
// ============================================================
// Supabase / PostgREST から返ってくる生のエラーメッセージを日本語に丸める。
// 0025 migration 後は RPC が日本語メッセージを直接返すので、それを優先する。
function mapJoinError(raw: string): string {
  if (!raw) return 'コミュニティ参加に失敗しました。時間をおいて再度お試しください。';
  // RPC が直接返す日本語メッセージ
  if (/^[ぁ-んァ-ヴ一-龯]/.test(raw)) return raw;

  const m = raw.toLowerCase();
  if (m.includes('row-level security') || m.includes('行レベル') || m.includes('rls')) {
    return 'ログイン状態が古くなっています。一度ログアウトして入り直すか、しばらく経ってから再試行してください。';
  }
  if (m.includes('not_authenticated') || m.includes('jwt') || m.includes('not authenticated')) {
    return 'ログイン情報を確認できませんでした。再度ログインしてください。';
  }
  if (m.includes('invite_only') || m.includes('invite-only')) {
    return 'このコミュニティは招待制です。招待リンクから参加してください。';
  }
  if (m.includes('requires_approval') || m.includes('requires approval')) {
    return 'このコミュニティは参加申請が必要です。';
  }
  if (m.includes('community_not_found') || m.includes('not found')) {
    return 'コミュニティが見つかりません。削除された可能性があります。';
  }
  if (m.includes('duplicate key') || m.includes('unique constraint') || m.includes('already')) {
    return '既にこのコミュニティに登録 / 申請済みです。';
  }
  if (m.includes('network') || m.includes('fetch failed')) {
    return 'ネットワークエラー。接続を確認してください。';
  }
  // 監査追加: PostgreSQL の標準エラーコード / メッセージを追加翻訳
  if (m.includes('permission denied') || m.includes('insufficient_privilege') || m.includes('42501')) {
    return 'この操作を行う権限がありません。';
  }
  if (m.includes('pgrst') && m.includes('no row')) {
    return '対象が見つかりません。削除された可能性があります。';
  }
  if (m.includes('rate-limit') || m.includes('rate_limit') || m.includes('53300')) {
    return '短時間に試行しすぎました。少し時間を置いてからお試しください。';
  }
  if (m.includes('foreign key') || m.includes('23503')) {
    return '依存関係のあるデータがあるため操作できません。';
  }
  if (m.includes('check constraint') || m.includes('23514')) {
    return '入力内容が制約を満たしていません。';
  }
  if (m.includes('22023')) {
    return '不正な状態遷移です (承認済み/却下済みからは変更できません)。';
  }
  return raw;
}

// ============================================================
// コミュニティに参加 (open / invite)
// ============================================================
export async function joinCommunity(id: string): Promise<{ error: string | null }> {
  // セッションが古いと RPC 内の auth.uid() が null になる事故を防ぐ
  await supabase.auth.refreshSession().catch(() => {});
  const { error } = await supabase.rpc('join_community_by_id', { c_id: id });
  if (error) return { error: mapJoinError(error.message) };
  return { error: null };
}

// ============================================================
// 参加申請 (request 制)
// ============================================================
export async function requestJoinCommunity(id: string, message = ''): Promise<{ error: string | null }> {
  // セッション refresh — defense in depth
  await supabase.auth.refreshSession().catch(() => {});
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'ログインしてください' };
  // user_id / status は BEFORE INSERT trigger (0025) が server side で強制するので
  // client からセットしなくても良いが、明示的に渡しておく (旧 client 互換)。
  const { error } = await supabase
    .from('community_join_requests')
    .upsert({ community_id: id, user_id: user.id, message, status: 'pending' });
  if (error) return { error: mapJoinError(error.message) };
  return { error: null };
}

// ============================================================
// 参加申請 — owner 用: 一覧取得 / 承認 / 拒否
// ------------------------------------------------------------
// request 制コミュニティで status='pending' の申請を取得・処理する。
// RLS:
//   - SELECT: owner / 申請者自身が見られる (0017)
//   - UPDATE: owner のみ (0017)
//   - community_members INSERT: owner が他人を追加可 (0026 trigger 経由)
// admin.tsx の「参加申請」セクションから呼ばれる。
// ============================================================
export type JoinRequestWithProfile = {
  community_id: string;
  user_id: string;
  message: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  nickname: string;
  avatar_emoji: string | null;
  avatar_url: string | null;
};

export async function fetchPendingJoinRequests(
  communityId: string,
): Promise<JoinRequestWithProfile[]> {
  if (!UUID_RE.test(communityId)) return [];
  // profiles を user_id 経由で join (公開 view profiles_public でも OK だが、
  // owner は自コミュニティに限り通常 profiles を読める想定)
  const { data, error } = await supabase
    .from('community_join_requests')
    .select('community_id, user_id, message, status, created_at, profiles!user_id ( nickname, avatar_emoji, avatar_url )')
    .eq('community_id', communityId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('[communities] fetchPendingJoinRequests:', error.message);
    return [];
  }
  // Supabase JS は FK join の戻りを array で推論しがち (たとえ to-one でも)。
  // 配列で受け取り [0] を取り出す形に統一して TS と整合させる。
  type ProfileLite = { nickname: string | null; avatar_emoji: string | null; avatar_url: string | null };
  type Row = {
    community_id: string;
    user_id: string;
    message: string | null;
    status: 'pending' | 'approved' | 'rejected';
    created_at: string;
    profiles: ProfileLite[] | ProfileLite | null;
  };
  return ((data ?? []) as unknown as Row[]).map((r) => {
    const p = Array.isArray(r.profiles) ? r.profiles[0] ?? null : r.profiles;
    return {
      community_id: r.community_id,
      user_id: r.user_id,
      message: r.message ?? '',
      status: r.status,
      created_at: r.created_at,
      nickname: p?.nickname ?? '匿名',
      avatar_emoji: p?.avatar_emoji ?? null,
      avatar_url: p?.avatar_url ?? null,
    };
  });
}

export async function approveJoinRequest(
  communityId: string,
  userId: string,
): Promise<{ error: string | null }> {
  if (!UUID_RE.test(communityId) || !UUID_RE.test(userId)) {
    return { error: '不正な ID です' };
  }
  // セッション refresh — RLS の auth.uid() が null になる事故を防ぐ
  await supabase.auth.refreshSession().catch(() => {});
  // 1. community_members に追加 (owner なら 0026 trigger で他人 INSERT が許可される)
  const { error: insErr } = await supabase
    .from('community_members')
    .insert({ community_id: communityId, user_id: userId, role: 'member' });
  if (insErr && !insErr.message.toLowerCase().includes('duplicate')) {
    // 既存メンバーなら duplicate でスキップ、それ以外は失敗
    console.warn('[communities] approveJoinRequest insert:', insErr.message);
    return { error: insErr.message };
  }
  // 2. 申請の status を approved に更新 (一覧から消える)
  const { error: updErr } = await supabase
    .from('community_join_requests')
    .update({ status: 'approved' })
    .eq('community_id', communityId)
    .eq('user_id', userId);
  if (updErr) {
    console.warn('[communities] approveJoinRequest update:', updErr.message);
    return { error: updErr.message };
  }
  return { error: null };
}

export async function rejectJoinRequest(
  communityId: string,
  userId: string,
): Promise<{ error: string | null }> {
  if (!UUID_RE.test(communityId) || !UUID_RE.test(userId)) {
    return { error: '不正な ID です' };
  }
  await supabase.auth.refreshSession().catch(() => {});
  const { error } = await supabase
    .from('community_join_requests')
    .update({ status: 'rejected' })
    .eq('community_id', communityId)
    .eq('user_id', userId);
  if (error) {
    console.warn('[communities] rejectJoinRequest:', error.message);
    return { error: error.message };
  }
  return { error: null };
}

// ============================================================
// コミュニティから退出
// ============================================================
// 監査での指摘 (Critical):
//   - owner が脱退すると「孤児コミュ」が生成される (誰も管理できない)
//   - 公式コミュ管理者が脱退しても official_admin_user_id が残り、
//     attachOfficialAuthor で de-anonymize が継続する
// → 本関数で role / 公式 admin を検査して、危険なケースは block する。
export async function leaveCommunity(id: string): Promise<{ error: string | null }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'ログインしてください' };

  // 自分の role と community の公式情報を取得 (1 RTT)
  const [meRes, commRes] = await Promise.all([
    supabase
      .from('community_members')
      .select('role')
      .eq('community_id', id)
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('communities')
      .select('is_official, official_admin_user_id')
      .eq('id', id)
      .maybeSingle(),
  ]);

  const role = (meRes.data as { role: MemberRole } | null)?.role ?? null;
  if (role === 'owner') {
    return {
      error: 'コミュニティのオーナーは退出できません。先に所有権を譲渡するか、コミュニティを削除してください。',
    };
  }

  const comm = commRes.data as { is_official: boolean | null; official_admin_user_id: string | null } | null;
  if (comm?.is_official && comm.official_admin_user_id === user.id) {
    return {
      error: '公式コミュニティの管理者は退出できません。先に公式申請の取り下げ、または管理者の変更を申請してください。',
    };
  }

  const { error } = await supabase
    .from('community_members')
    .delete()
    .eq('community_id', id)
    .eq('user_id', user.id);
  if (error) return { error: mapJoinError(error.message) };
  return { error: null };
}

// ============================================================
// 所属コミュニティの最新投稿フィード (Post[] バージョン)
// ============================================================
// AnonPostCard と互換性のある Post[] と、各 post → community メタの map を返す。
// コミュタブのトップで「コミュ詳細と同じ表示密度」で投稿を見るために使う。
// 旧 fetchMyCommunityFeed (CommunityPostWithCommunity[]) は useObsidian など
// 既存利用が残っているので保留。
// ============================================================
import type { Post } from '../../types/models';

export type CommunityMetaLite = {
  id: string;
  name: string;
  icon_emoji: string;
  icon_color: string;
  icon_url: string | null;
  is_official: boolean;
};

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
    const posts: Post[] = rpcPosts.map((p) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { community_id: _cid, author_nickname: _nick, community: _comm, ...rest } = p;
      return rest as Post;
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
  // POSTS_SELECT_COLS (lib/api/posts.ts) と同じセット
  const POSTS_SELECT_COLS =
    'id, content, media_urls, media_blurhashes, tag_names, likes_count, comments_count, score, hot_score, concern_count, kind, source_url, is_public, trust_score_at_post, is_anonymous, content_warning, cw_category, visibility, created_at, author_id';
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

// ============================================================
// 旧 API: createCommunityPost / fetchCommunityPosts (廃止)
// ============================================================
// 旧スキーマで使われていた `community_posts` テーブルは migration 0023 以降
// `posts` + `post_communities` に置き換えられている。
//
// - 投稿は app/post/create.tsx 経由で createPost (lib/api/posts.ts) を使用
//   → visibility='community_only' または 'community_public' + community_ids[]
// - 1 コミュニティの投稿一覧は fetchCommunityPosts (lib/api/posts.ts) を使用
//   → post_communities 中間テーブル経由
// - 所属コミュ全体のフィードは fetchMyCommunityFeed (本ファイル上部)
//
// ここに残っていた旧関数 (createCommunityPost / 同名 fetchCommunityPosts) は
// `community_posts` テーブル (実体無し) を参照する dead code だったため削除。
// 復活が必要な場合は git log を参照。
// ============================================================

// ============================================================
// コミュニティアイコン画像のアップロード
// path 規約: '<community_id>/<timestamp>.<ext>'
// (Storage RLS でこの community_id のメンバーだけ書き込めるよう制限してある)
// 仮の community_id (作成前) を渡したい場合は createCommunity 成功後にもう一度
// updateCommunity({ icon_url }) を呼ぶ必要がある — そのため tmp uploads は
// 自前の bucket folder 'pending/<user_id>/...' を使うパターンも検討余地あり。
// ============================================================
// body は Web では Blob、Native では FormData (file uri 含む) を受け付ける。
// 監査指摘 + 実機 NG 報告反映:
//   - 旧版 1: Blob 専用 → Native では Blob.slice/arrayBuffer が動かず失敗
//   - 旧版 2: Uint8Array → Supabase SDK が fetch(body: uint8array) を呼ぶが、
//             Android okhttp で確実に serialize されない → 失敗
//   - 新版  : Native は FormData with file uri (RN 標準の multipart 経路)
//             Supabase SDK は FormData を直接 multipart として送るので確実に動く
export async function uploadCommunityIcon(
  community_id: string,
  body: Blob | FormData | Uint8Array | ArrayBuffer,
  contentType = 'image/jpeg',
): Promise<{ url: string | null; error: string | null }> {
  // 防御: community_id を UUID 検証 (Storage RLS の foldername と整合)
  if (!UUID_RE.test(community_id)) {
    return { url: null, error: '不正なコミュニティ ID です' };
  }
  // 防御: contentType を allowed mime に絞る (path traversal / 不正拡張子防止)
  const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
  const safeContentType = ALLOWED.has(contentType) ? contentType : 'image/jpeg';
  const ext = safeContentType.split('/')[1] ?? 'jpg';
  const path = `${community_id}/${Date.now()}.${ext}`;

  // Supabase SDK 内部: FormData → そのまま multipart 送信 (cacheControl 追加)
  //                   Blob     → FormData にラップして multipart 送信
  //                   その他   → body そのまま + content-type header
  try {
    const { error: upErr } = await supabase.storage.from('community-icons').upload(
      path,
      // SDK の型シグネチャは Blob | File | FormData | ArrayBuffer | ArrayBufferView |
      // NodeJS.ReadableStream | ReadableStream | URLSearchParams | string の union。
      // FormData / Blob どちらも受け付けるが、TS が複雑になるので unknown 経由でキャスト。
      body as unknown as Blob,
      {
        contentType: safeContentType,
        upsert: true,
        cacheControl: '3600',
      },
    );
    if (upErr) {
      // 詳細を返してデバッグを容易に
      console.warn('[uploadCommunityIcon] storage upload failed:', upErr);
      return { url: null, error: `アップロード失敗: ${upErr.message}` };
    }
  } catch (e) {
    // ネットワークエラー等
    console.warn('[uploadCommunityIcon] threw:', e);
    return { url: null, error: `アップロード中にエラーが発生しました: ${e instanceof Error ? e.message : String(e)}` };
  }

  const { data: pub } = supabase.storage.from('community-icons').getPublicUrl(path);
  return { url: pub.publicUrl, error: null };
}

// ============================================================
// 聖地 (community_spots) API
// ============================================================
// 聖地一覧取得 (新しい順) — RLS で open/member だけが見える
export async function fetchCommunitySpots(community_id: string): Promise<CommunitySpot[]> {
  if (!UUID_RE.test(community_id)) return [];
  const { data, error } = await supabase
    .from('community_spots')
    .select('*')
    .eq('community_id', community_id)
    .order('created_at', { ascending: false })
    .limit(500); // DoS / OOM 防止: 1 コミュニティで 500 を超える聖地は viewport クエリ側で
  if (error) {
    console.warn('[communities] fetchCommunitySpots failed:', error.message);
    return [];
  }
  return (data ?? []) as CommunitySpot[];
}

// 1 件取得 — 編集 / 詳細画面で使用
export async function fetchSpotById(spot_id: string): Promise<CommunitySpot | null> {
  if (!UUID_RE.test(spot_id)) return null;
  const { data, error } = await supabase
    .from('community_spots')
    .select('*')
    .eq('id', spot_id)
    .single();
  if (error) {
    console.warn('[communities] fetchSpotById failed:', error.message);
    return null;
  }
  return data as CommunitySpot;
}

// 聖地作成 (メンバーのみ — RLS で担保)
// migration 0045 で category 必須 + photo_urls (複数) 追加
export async function createSpot(input: {
  community_id: string;
  name: string;
  description?: string;
  lat: number;
  lon: number;
  category: SpotCategory;
  photo_urls?: string[];
  /** @deprecated 旧版互換。新規は photo_urls を使う */
  photo_url?: string;
}): Promise<{ data: CommunitySpot | null; error: string | null }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'ログインしてください' };

  // 名前 / 説明 sanitize (sanitizeText = trim/on..=削除しない緩い版)
  const safeName = sanitizeText(input.name, { maxLength: 80 }).trim();
  const safeDesc = sanitizeText(input.description ?? '', { maxLength: 500 });
  if (safeName.length < 1) return { data: null, error: '名前を入力してください' };

  // lat/lon の範囲チェック (DB の CHECK 制約も二重に守る)
  if (input.lat < -90 || input.lat > 90 || input.lon < -180 || input.lon > 180) {
    return { data: null, error: '緯度・経度が範囲外です' };
  }

  // category は allowlist 外なら fail-safe で 'other'
  const safeCategory: SpotCategory = SELECTABLE_SPOT_CATEGORIES.includes(input.category)
    ? input.category
    : 'other';

  // 写真は最大 4 枚 (DB CHECK 制約も二重に守る)
  const safePhotos = (input.photo_urls ?? []).slice(0, 4).filter((u) => !!u);

  const { data, error } = await supabase
    .from('community_spots')
    .insert({
      community_id: input.community_id,
      name: safeName,
      description: safeDesc,
      lat: input.lat,
      lon: input.lon,
      category: safeCategory,
      photo_urls: safePhotos,
      photo_url: input.photo_url ?? null,
      created_by: user.id,
    })
    .select()
    .single();
  if (error || !data) return { data: null, error: error?.message ?? '聖地登録に失敗しました' };
  return { data: data as CommunitySpot, error: null };
}

// 聖地更新 (migration 0045 で community member 全員に編集権を開放: wiki 型)
export async function updateSpot(
  spot_id: string,
  patch: Partial<{
    name: string;
    description: string;
    lat: number;
    lon: number;
    category: SpotCategory;
    photo_urls: string[];
  }>,
): Promise<{ data: CommunitySpot | null; error: string | null }> {
  // ホワイトリスト化 — 想定外の column 書き換えを防ぐ
  const allowed: Partial<Pick<CommunitySpot, 'name' | 'description' | 'lat' | 'lon' | 'category' | 'photo_urls'>> = {};
  if (patch.name !== undefined) {
    const s = sanitizeText(patch.name, { maxLength: 80 }).trim();
    if (s.length < 1) return { data: null, error: '名前は 1 文字以上必要です' };
    allowed.name = s;
  }
  if (patch.description !== undefined) {
    allowed.description = sanitizeText(patch.description, { maxLength: 500 });
  }
  if (patch.lat !== undefined) {
    if (patch.lat < -90 || patch.lat > 90) return { data: null, error: '緯度が範囲外です' };
    allowed.lat = patch.lat;
  }
  if (patch.lon !== undefined) {
    if (patch.lon < -180 || patch.lon > 180) return { data: null, error: '経度が範囲外です' };
    allowed.lon = patch.lon;
  }
  if (patch.category !== undefined) {
    allowed.category = SELECTABLE_SPOT_CATEGORIES.includes(patch.category) ? patch.category : 'other';
  }
  if (patch.photo_urls !== undefined) {
    allowed.photo_urls = patch.photo_urls.slice(0, 4).filter((u) => !!u);
  }

  const { data, error } = await supabase
    .from('community_spots')
    .update(allowed)
    .eq('id', spot_id)
    .select()
    .single();
  if (error || !data) return { data: null, error: error?.message ?? '聖地の更新に失敗しました' };
  return { data: data as CommunitySpot, error: null };
}

// 聖地削除 (migration 0045 で community member 全員に削除権を開放: wiki 型)
export async function deleteSpot(spot_id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('community_spots').delete().eq('id', spot_id);
  if (error) return { error: error.message };
  return { error: null };
}

// 公認フラグの toggle (公式コミュニティの official_admin だけが操作可)
export async function toggleSpotCertified(spotId: string, certified: boolean): Promise<void> {
  const { error } = await supabase.rpc('toggle_spot_certified', {
    p_spot_id: spotId,
    p_certified: certified,
  });
  if (error) {
    // 監査指摘: 旧版は error.message の string match だけで脆い。
    // PostgreSQL の error code (PGRST 経由) も判定対象に。
    const msg = error.message || '';
    const code = (error as { code?: string }).code ?? '';
    if (msg.includes('NOT_OFFICIAL_ADMIN') || code === '42501') {
      throw new Error('公式管理者のみ操作できます');
    }
    if (msg.includes('SPOT_NOT_FOUND') || msg.includes('not found')) {
      throw new Error('聖地が見つかりません');
    }
    throw new Error(mapJoinError(msg) || '公認設定に失敗しました');
  }
}

// ============================================================
// カレンダー (community_events) API
// ============================================================
// イベント一覧取得 — upcomingOnly=true で starts_at >= now() のみ返す
export async function fetchCommunityEvents(
  community_id: string,
  opts: { upcomingOnly?: boolean } = {},
): Promise<CommunityEvent[]> {
  if (!UUID_RE.test(community_id)) return [];
  let query = supabase
    .from('community_events')
    .select('*')
    .eq('community_id', community_id)
    .order('starts_at', { ascending: true })
    .limit(500); // 1 コミュニティの直近イベント上限 (現実的には十分)

  if (opts.upcomingOnly) {
    query = query.gte('starts_at', new Date().toISOString());
  }

  const { data, error } = await query;
  if (error) {
    console.warn('[communities] fetchCommunityEvents failed:', error.message);
    return [];
  }
  return (data ?? []) as CommunityEvent[];
}

// イベント作成 (メンバーのみ — RLS で担保)
export async function createEvent(input: {
  community_id: string;
  title: string;
  description?: string;
  starts_at: string;       // ISO 8601
  ends_at?: string;        // ISO 8601 — null 許容
  location_text?: string;
  photo_url?: string;
  // migration 0046: 会場 spot を指定 (任意)。指定時はサーバ側 trigger で
  // spot.community_id == event.community_id を検証 (SPOT_COMMUNITY_MISMATCH)。
  spot_id?: string | null;
}): Promise<{ data: CommunityEvent | null; error: string | null }> {
  if (!UUID_RE.test(input.community_id)) {
    return { data: null, error: '不正なコミュニティ ID です' };
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'ログインしてください' };

  // sanitizeText = trim/on..=削除しない緩い版 (title だけ trim() で minLen 判定)
  const safeTitle = sanitizeText(input.title, { maxLength: 100 }).trim();
  const safeDesc = sanitizeText(input.description ?? '', { maxLength: 1000 });
  const safeLocation = input.location_text
    ? sanitizeText(input.location_text, { maxLength: 200 })
    : null;
  if (safeTitle.length < 1) return { data: null, error: 'タイトルを入力してください' };

  // ISO 8601 形式チェック (壊れた日付で 500 を防ぐ)
  const startsAt = new Date(input.starts_at);
  if (Number.isNaN(startsAt.getTime())) {
    return { data: null, error: '開始日時が不正です' };
  }
  let endsAt: string | null = null;
  if (input.ends_at) {
    const e = new Date(input.ends_at);
    if (Number.isNaN(e.getTime())) return { data: null, error: '終了日時が不正です' };
    // 監査指摘: 旧版は `<` で「同時刻」を許容、フロント (event/create.tsx) は `>` を要求していて
    // 不一致だった。最小 1 分のスパンを要求して 0 分イベントも排除。
    if (e.getTime() <= startsAt.getTime()) {
      return { data: null, error: '終了日時は開始日時より後にしてください' };
    }
    endsAt = e.toISOString();
  }

  // spot_id は UUID チェックだけ、存在検証は trigger 側 (RLS と二重防御)
  const safeSpotId: string | null = input.spot_id && UUID_RE.test(input.spot_id) ? input.spot_id : null;

  const { data, error } = await supabase
    .from('community_events')
    .insert({
      community_id: input.community_id,
      title: safeTitle,
      description: safeDesc,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt,
      location_text: safeLocation,
      photo_url: input.photo_url ?? null,
      spot_id: safeSpotId,
      created_by: user.id,
    })
    .select()
    .single();
  if (error || !data) {
    const msg = error?.message ?? 'イベント作成に失敗しました';
    if (msg.includes('SPOT_COMMUNITY_MISMATCH')) {
      return { data: null, error: '指定した聖地が別コミュニティのものです' };
    }
    if (msg.includes('SPOT_NOT_FOUND')) {
      return { data: null, error: '指定した聖地が見つかりません' };
    }
    return { data: null, error: msg };
  }
  return { data: data as CommunityEvent, error: null };
}

// イベント更新 (作成者 or community owner — RLS で担保)
// migration 0046: spot_id の付け替え対応
export async function updateEvent(
  event_id: string,
  patch: Partial<{
    title: string;
    description: string;
    starts_at: string;
    ends_at: string | null;
    location_text: string | null;
    photo_url: string | null;
    spot_id: string | null;
  }>,
): Promise<{ data: CommunityEvent | null; error: string | null }> {
  const allowed: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    const s = sanitizeText(patch.title, { maxLength: 100 }).trim();
    if (s.length < 1) return { data: null, error: 'タイトルは 1 文字以上必要です' };
    allowed.title = s;
  }
  if (patch.description !== undefined) {
    allowed.description = sanitizeText(patch.description, { maxLength: 1000 });
  }
  if (patch.starts_at !== undefined) {
    const d = new Date(patch.starts_at);
    if (Number.isNaN(d.getTime())) return { data: null, error: '開始日時が不正です' };
    allowed.starts_at = d.toISOString();
  }
  if (patch.ends_at !== undefined) {
    if (patch.ends_at === null) {
      allowed.ends_at = null;
    } else {
      const d = new Date(patch.ends_at);
      if (Number.isNaN(d.getTime())) return { data: null, error: '終了日時が不正です' };
      allowed.ends_at = d.toISOString();
    }
  }
  if (patch.location_text !== undefined) {
    allowed.location_text = patch.location_text
      ? sanitizeText(patch.location_text, { maxLength: 200 })
      : null;
  }
  if (patch.photo_url !== undefined) allowed.photo_url = patch.photo_url;
  if (patch.spot_id !== undefined) {
    allowed.spot_id = patch.spot_id && UUID_RE.test(patch.spot_id) ? patch.spot_id : null;
  }

  const { data, error } = await supabase
    .from('community_events')
    .update(allowed)
    .eq('id', event_id)
    .select()
    .single();
  if (error || !data) {
    const msg = error?.message ?? 'イベント更新に失敗しました';
    if (msg.includes('SPOT_COMMUNITY_MISMATCH')) {
      return { data: null, error: '指定した聖地が別コミュニティのものです' };
    }
    return { data: null, error: msg };
  }
  return { data: data as CommunityEvent, error: null };
}

// イベント削除 (作成者 or community owner — RLS で担保)
export async function deleteEvent(event_id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('community_events').delete().eq('id', event_id);
  if (error) return { error: error.message };
  return { error: null };
}

// 1 spot に紐付く upcoming イベントを取得 (spot 詳細 / spot map で使う)
// migration 0046 で community_events.spot_id を追加
export async function fetchEventsBySpot(
  spot_id: string,
  opts: { upcomingOnly?: boolean; limit?: number } = {},
): Promise<CommunityEvent[]> {
  if (!UUID_RE.test(spot_id)) return [];
  const limit = Math.max(1, Math.min(opts.limit ?? 20, 100));
  let query = supabase
    .from('community_events')
    .select('*')
    .eq('spot_id', spot_id)
    .order('starts_at', { ascending: true })
    .limit(limit);
  if (opts.upcomingOnly !== false) {
    query = query.gte('starts_at', new Date().toISOString());
  }
  const { data, error } = await query;
  if (error) {
    console.warn('[communities] fetchEventsBySpot failed:', error.message);
    return [];
  }
  return (data ?? []) as CommunityEvent[];
}
