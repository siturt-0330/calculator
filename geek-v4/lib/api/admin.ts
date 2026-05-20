import { supabase } from '../supabase';

// ============================================================
// 開発者 admin 専用 API。 RLS は 0025_admin_role.sql で
// is_admin=true な profile に対し profiles / posts / bbs_threads /
// communities への全権アクセスを許可する形で導入済み。
// client は自身の JWT を使うので service_role キーは露出しない。
// ============================================================

export type AdminUser = {
  id: string;
  nickname: string | null;
  account_state: string;
  trust_score: number;
  post_count: number;
  concern_received_count: number;
  is_admin: boolean;
  created_at: string;
};

export type AdminPost = {
  id: string;
  author_id: string;
  author_nickname: string | null;
  content: string;
  visibility: string;
  likes_count: number;
  concern_count: number;
  created_at: string;
};

export async function fetchAllUsers(opts?: { search?: string; limit?: number }): Promise<AdminUser[]> {
  let q = supabase
    .from('profiles')
    .select('id, nickname, account_state, trust_score, post_count, concern_received_count, is_admin, created_at')
    .order('created_at', { ascending: false })
    .limit(opts?.limit ?? 100);
  if (opts?.search && opts.search.trim().length > 0) {
    q = q.ilike('nickname', `%${opts.search.trim()}%`);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as AdminUser[];
}

export async function fetchAllPosts(opts?: { search?: string; limit?: number }): Promise<AdminPost[]> {
  // posts.author_id の FK は auth.users(id) で profiles ではない為、
  // PostgREST の embed では取れない。 2 段階フェッチで nickname を join する。
  let q = supabase
    .from('posts')
    .select('id, author_id, content, visibility, likes_count, concern_count, created_at')
    .order('created_at', { ascending: false })
    .limit(opts?.limit ?? 100);
  if (opts?.search && opts.search.trim().length > 0) {
    q = q.ilike('content', `%${opts.search.trim()}%`);
  }
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    id: string;
    author_id: string;
    content: string;
    visibility: string;
    likes_count: number;
    concern_count: number;
    created_at: string;
  }>;
  if (rows.length === 0) return [];

  // 著者 ID をユニーク化して 1 回でまとめて取得 (N+1 防止)
  const authorIds = Array.from(new Set(rows.map((r) => r.author_id)));
  const nicknameMap = new Map<string, string>();
  if (authorIds.length > 0) {
    const { data: profiles, error: pErr } = await supabase
      .from('profiles')
      .select('id, nickname')
      .in('id', authorIds);
    if (!pErr && profiles) {
      for (const p of profiles as Array<{ id: string; nickname: string | null }>) {
        if (p.nickname) nicknameMap.set(p.id, p.nickname);
      }
    }
  }

  return rows.map((p) => ({
    id: p.id,
    author_id: p.author_id,
    author_nickname: nicknameMap.get(p.author_id) ?? null,
    content: p.content,
    visibility: p.visibility,
    likes_count: p.likes_count,
    concern_count: p.concern_count,
    created_at: p.created_at,
  }));
}

export async function suspendUser(userId: string): Promise<void> {
  const { error } = await supabase.from('profiles').update({ account_state: 'suspended' }).eq('id', userId);
  if (error) throw error;
}

export async function unsuspendUser(userId: string): Promise<void> {
  const { error } = await supabase.from('profiles').update({ account_state: 'healthy' }).eq('id', userId);
  if (error) throw error;
}

export async function deletePost(postId: string): Promise<void> {
  const { error } = await supabase.from('posts').delete().eq('id', postId);
  if (error) throw error;
}
