import { supabase } from '../supabase';
import { generateVariants } from '../search/variants';
import { findSimilar } from '../search/similarity';
import { sanitizeContent } from '../sanitize';

export type Visibility = 'open' | 'request' | 'invite';
export type MemberRole = 'owner' | 'admin' | 'member';

export type Community = {
  id: string;
  name: string;
  description: string;
  icon_emoji: string;
  icon_color: string;
  icon_url: string | null;
  visibility: Visibility;
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
// ============================================================
export type CommunitySpot = {
  id: string;
  community_id: string;
  name: string;
  description: string;
  lat: number;
  lon: number;
  photo_url: string | null;
  created_by: string;
  created_at: string;
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
};

export type CommunityPostWithCommunity = CommunityPost & {
  community: Pick<Community, 'id' | 'name' | 'icon_emoji' | 'icon_color' | 'icon_url' | 'is_official'>;
  author_nickname?: string;
};

// ============================================================
// 自分の所属コミュニティを取得 (TopBar 用)
// ============================================================
export async function fetchMyCommunities(): Promise<Community[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  // community_members 経由で join — joined_at desc
  const { data, error } = await supabase
    .from('community_members')
    .select('community_id, communities!inner(*)')
    .eq('user_id', user.id)
    .order('joined_at', { ascending: false });

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
// 所属コミュニティの最新投稿フィード (YouTube 動画リスト的)
// ============================================================
export async function fetchMyCommunityFeed(limit = 30): Promise<CommunityPostWithCommunity[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  // まず自分の所属 community_id を取得
  const { data: memberRows, error: memErr } = await supabase
    .from('community_members')
    .select('community_id')
    .eq('user_id', user.id);

  if (memErr || !memberRows || memberRows.length === 0) return [];

  const ids = memberRows.map((r) => r.community_id);

  const { data, error } = await supabase
    .from('community_posts')
    .select('*, community:communities(id, name, icon_emoji, icon_color, icon_url, is_official)')
    .in('community_id', ids)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn('[communities] fetchMyCommunityFeed failed:', error.message);
    return [];
  }

  // author の nickname を一括で取得 (community_posts.author_id は auth.users への FK
  // なので Supabase の embed では結べない — RTT は 1 増えるが、id .in() で 1 リクエスト)
  const authorIds = Array.from(new Set((data ?? []).map((p) => p.author_id)));
  let nickMap: Record<string, string> = {};
  if (authorIds.length > 0) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, nickname')
      .in('id', authorIds);
    nickMap = Object.fromEntries((profs ?? []).map((p) => [p.id, p.nickname]));
  }

  return (data ?? []).map((p) => ({
    ...p,
    author_nickname: nickMap[p.author_id],
  }));
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
  const safeName = sanitizeContent(input.name, { maxLength: 40 });
  const safeDesc = sanitizeContent(input.description, { maxLength: 500 });
  if (safeName.length < 2) {
    return { data: null, error: 'コミュニティ名は 2 文字以上にしてください' };
  }
  const { data, error } = await supabase
    .from('communities')
    .insert({
      name: safeName,
      description: safeDesc,
      icon_emoji: input.icon_emoji,
      icon_color: input.icon_color,
      icon_url: input.icon_url ?? null,
      visibility: input.visibility,
      created_by: user.id,
    })
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
// コミュニティ更新 (member 誰でも - icon/name/desc を変えられる)
// ============================================================
export async function updateCommunity(
  id: string,
  patch: Partial<Pick<Community, 'name' | 'description' | 'icon_emoji' | 'icon_color' | 'icon_url' | 'visibility'>>,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('communities').update(patch).eq('id', id);
  if (error) return { error: error.message };
  return { error: null };
}

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

  const [tagRes, membRes] = await Promise.all([
    supabase.from('community_tags').select('tag').eq('community_id', id),
    user
      ? supabase
          .from('community_members')
          .select('role')
          .eq('community_id', id)
          .eq('user_id', user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const tags = (tagRes.data ?? []).map((r) => r.tag);
  const role = (membRes.data as { role: MemberRole } | null)?.role ?? null;

  return {
    ...comm,
    tags,
    is_member: role !== null,
    role,
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
  const variants = generateVariants(q).slice(0, 6); // 上位 6 種類だけ — URL 肥大化防止
  const orClauses = variants
    .filter((v) => v.length >= 2)
    .map((v) => `name.ilike.%${v.replace(/[\\,()]/g, '')}%`);
  // フォールバック: orClauses が空なら q だけで ilike
  const orQuery = orClauses.length > 0 ? orClauses.join(',') : `name.ilike.%${q}%`;

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
// コミュニティ検索 (discover) — invite は除外
// variants で「ポケモン / pokemon / ぽけもん / pkmn」等の表記ゆらぎを吸収
// ============================================================
export async function discoverCommunities(opts: {
  query?: string;
  tag?: string;
  limit?: number;
}): Promise<Community[]> {
  let q = supabase
    .from('communities')
    .select('*')
    .in('visibility', ['open', 'request'])
    .order('member_count', { ascending: false })
    .limit(opts.limit ?? 30);

  const queryStr = opts.query?.trim();
  if (queryStr && queryStr.length > 0) {
    // バリエーション (大文字/半角/カタカナ/同義語) で or-ilike — URL 肥大化を避けて 6 種に制限
    const variants = generateVariants(queryStr).slice(0, 6);
    const orClauses = variants
      .filter((v) => v.length >= 1)
      .map((v) => `name.ilike.%${v.replace(/[\\,()]/g, '')}%`);
    if (orClauses.length > 0) {
      q = q.or(orClauses.join(','));
    } else {
      q = q.ilike('name', `%${queryStr}%`);
    }
  }
  // tag フィルタ
  if (opts.tag) {
    const { data: tagged } = await supabase
      .from('community_tags')
      .select('community_id')
      .eq('tag', opts.tag);
    const ids = (tagged ?? []).map((t) => t.community_id);
    if (ids.length === 0) return [];
    q = q.in('id', ids);
  }

  const { data, error } = await q;
  if (error) {
    console.warn('[communities] discover failed:', error.message);
    return [];
  }
  return data ?? [];
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
// コミュニティから退出
// ============================================================
export async function leaveCommunity(id: string): Promise<{ error: string | null }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'ログインしてください' };
  const { error } = await supabase
    .from('community_members')
    .delete()
    .eq('community_id', id)
    .eq('user_id', user.id);
  if (error) return { error: error.message };
  return { error: null };
}

// ============================================================
// コミュニティに投稿
// ============================================================
export async function createCommunityPost(input: {
  community_id: string;
  body: string;
  image_url?: string;
}): Promise<{ data: CommunityPost | null; error: string | null }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'ログインしてください' };

  const { data, error } = await supabase
    .from('community_posts')
    .insert({
      community_id: input.community_id,
      author_id: user.id,
      body: input.body.trim(),
      image_url: input.image_url ?? null,
    })
    .select()
    .single();
  if (error || !data) return { data: null, error: error?.message ?? '投稿に失敗しました' };
  return { data, error: null };
}

// ============================================================
// 1 コミュニティの投稿一覧
// ============================================================
export async function fetchCommunityPosts(
  community_id: string,
  limit = 30,
): Promise<CommunityPostWithCommunity[]> {
  const { data, error } = await supabase
    .from('community_posts')
    .select('*, community:communities(id, name, icon_emoji, icon_color, icon_url, is_official)')
    .eq('community_id', community_id)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn('[communities] fetchCommunityPosts failed:', error.message);
    return [];
  }
  const authorIds = Array.from(new Set((data ?? []).map((p) => p.author_id)));
  let nickMap: Record<string, string> = {};
  if (authorIds.length > 0) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, nickname')
      .in('id', authorIds);
    nickMap = Object.fromEntries((profs ?? []).map((p) => [p.id, p.nickname]));
  }
  return (data ?? []).map((p) => ({ ...p, author_nickname: nickMap[p.author_id] }));
}

// ============================================================
// コミュニティアイコン画像のアップロード
// path 規約: '<community_id>/<timestamp>.<ext>'
// (Storage RLS でこの community_id のメンバーだけ書き込めるよう制限してある)
// 仮の community_id (作成前) を渡したい場合は createCommunity 成功後にもう一度
// updateCommunity({ icon_url }) を呼ぶ必要がある — そのため tmp uploads は
// 自前の bucket folder 'pending/<user_id>/...' を使うパターンも検討余地あり。
// ============================================================
export async function uploadCommunityIcon(
  community_id: string,
  blob: Blob,
  contentType = 'image/jpeg',
): Promise<{ url: string | null; error: string | null }> {
  const ext = contentType.split('/')[1] ?? 'jpg';
  const path = `${community_id}/${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage.from('community-icons').upload(path, blob, {
    contentType,
    upsert: true,
    cacheControl: '3600',
  });
  if (upErr) return { url: null, error: upErr.message };
  const { data: pub } = supabase.storage.from('community-icons').getPublicUrl(path);
  return { url: pub.publicUrl, error: null };
}

// ============================================================
// 聖地 (community_spots) API
// ============================================================
// 聖地一覧取得 (新しい順) — RLS で open/member だけが見える
export async function fetchCommunitySpots(community_id: string): Promise<CommunitySpot[]> {
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

// 聖地作成 (メンバーのみ — RLS で担保)
export async function createSpot(input: {
  community_id: string;
  name: string;
  description?: string;
  lat: number;
  lon: number;
  photo_url?: string;
}): Promise<{ data: CommunitySpot | null; error: string | null }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'ログインしてください' };

  // 名前 / 説明 sanitize
  const safeName = sanitizeContent(input.name, { maxLength: 80 });
  const safeDesc = sanitizeContent(input.description ?? '', { maxLength: 500 });
  if (safeName.length < 1) return { data: null, error: '名前を入力してください' };

  // lat/lon の範囲チェック (DB の CHECK 制約も二重に守る)
  if (input.lat < -90 || input.lat > 90 || input.lon < -180 || input.lon > 180) {
    return { data: null, error: '緯度・経度が範囲外です' };
  }

  const { data, error } = await supabase
    .from('community_spots')
    .insert({
      community_id: input.community_id,
      name: safeName,
      description: safeDesc,
      lat: input.lat,
      lon: input.lon,
      photo_url: input.photo_url ?? null,
      created_by: user.id,
    })
    .select()
    .single();
  if (error || !data) return { data: null, error: error?.message ?? '聖地登録に失敗しました' };
  return { data: data as CommunitySpot, error: null };
}

// 聖地削除 (作成者 or community owner — RLS で担保)
export async function deleteSpot(spot_id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('community_spots').delete().eq('id', spot_id);
  if (error) return { error: error.message };
  return { error: null };
}

// ============================================================
// カレンダー (community_events) API
// ============================================================
// イベント一覧取得 — upcomingOnly=true で starts_at >= now() のみ返す
export async function fetchCommunityEvents(
  community_id: string,
  opts: { upcomingOnly?: boolean } = {},
): Promise<CommunityEvent[]> {
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
}): Promise<{ data: CommunityEvent | null; error: string | null }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'ログインしてください' };

  const safeTitle = sanitizeContent(input.title, { maxLength: 100 });
  const safeDesc = sanitizeContent(input.description ?? '', { maxLength: 1000 });
  const safeLocation = input.location_text
    ? sanitizeContent(input.location_text, { maxLength: 200 })
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
    if (e.getTime() < startsAt.getTime()) {
      return { data: null, error: '終了日時は開始日時より後にしてください' };
    }
    endsAt = e.toISOString();
  }

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
      created_by: user.id,
    })
    .select()
    .single();
  if (error || !data) return { data: null, error: error?.message ?? 'イベント作成に失敗しました' };
  return { data: data as CommunityEvent, error: null };
}

// イベント削除 (作成者 or community owner — RLS で担保)
export async function deleteEvent(event_id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('community_events').delete().eq('id', event_id);
  if (error) return { error: error.message };
  return { error: null };
}
