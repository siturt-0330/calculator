import { supabase } from '@/lib/supabase';

export type Visibility = 'open' | 'request' | 'invite';
export type MemberRole = 'owner' | 'admin' | 'member';

export type Community = {
  id: string;
  name: string;
  description: string;
  icon_emoji: string;
  icon_color: string;
  visibility: Visibility;
  member_count: number;
  post_count: number;
  last_post_at: string | null;
  created_by: string;
  created_at: string;
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

export type CommunityPostWithCommunity = CommunityPost & {
  community: Pick<Community, 'id' | 'name' | 'icon_emoji' | 'icon_color'>;
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
    .select('*, community:communities(id, name, icon_emoji, icon_color)')
    .in('community_id', ids)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn('[communities] fetchMyCommunityFeed failed:', error.message);
    return [];
  }

  // author の nickname を一括で取得
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
  visibility: Visibility;
  tags: string[];
}): Promise<{ data: Community | null; error: string | null }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'ログインしてください' };

  const { data, error } = await supabase
    .from('communities')
    .insert({
      name: input.name.trim(),
      description: input.description.trim(),
      icon_emoji: input.icon_emoji,
      icon_color: input.icon_color,
      visibility: input.visibility,
      created_by: user.id,
    })
    .select()
    .single();

  if (error || !data) {
    return { data: null, error: error?.message ?? 'コミュニティ作成に失敗しました' };
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
  patch: Partial<Pick<Community, 'name' | 'description' | 'icon_emoji' | 'icon_color' | 'visibility'>>,
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
// コミュニティ検索 (discover) — invite は除外
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

  if (opts.query && opts.query.trim().length > 0) {
    // ilike 部分一致
    q = q.ilike('name', `%${opts.query.trim()}%`);
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
// コミュニティに参加 (open / invite)
// ============================================================
export async function joinCommunity(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('join_community_by_id', { c_id: id });
  if (error) return { error: error.message };
  return { error: null };
}

// ============================================================
// 参加申請 (request 制)
// ============================================================
export async function requestJoinCommunity(id: string, message = ''): Promise<{ error: string | null }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'ログインしてください' };
  const { error } = await supabase
    .from('community_join_requests')
    .upsert({ community_id: id, user_id: user.id, message, status: 'pending' });
  if (error) return { error: error.message };
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
    .select('*, community:communities(id, name, icon_emoji, icon_color)')
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
