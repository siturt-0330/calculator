import { supabase } from '@/lib/supabase';
import type { BBSThread, BBSReply, Comment, ThreadVisibility } from '@/types/models';
import { sanitizeContent } from '@/lib/sanitize';
import { checkRate, rateLimitMessage } from '@/lib/rateLimit';

export type { ThreadVisibility } from '@/types/models';

// bbs_threads SELECT で取得するカラム一覧 (一箇所でメンテ可能)
// migration 0023 で community_id + visibility を追加
const BBS_THREAD_SELECT_COLS =
  'id, title, category, replies_count, last_reply_at, created_at, community_id, visibility';

// シードデータが残してしまった "[v3] " などの内部マーカープレフィックスは
// ユーザーに見せたくないので、クライアント側で読み出し時に必ず除去する。
// DB の UPDATE を待たなくてもこの関数1つで全画面のタイトルが綺麗になる。
const INTERNAL_PREFIX_RE = /^\s*\[v\d+\]\s*/;
function cleanTitle(title: string | null | undefined): string {
  if (!title) return '';
  return title.replace(INTERNAL_PREFIX_RE, '');
}

export async function fetchThread(id: string): Promise<BBSThread | null> {
  if (!id) return null;
  // UUID 形式チェック (古い URL や壊れた ID への対策)
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(id)) return null;
  const { data, error } = await supabase
    .from('bbs_threads')
    .select(BBS_THREAD_SELECT_COLS)
    .eq('id', id)
    .maybeSingle();
  if (error) {
    console.warn('[fetchThread] error:', error.message);
    throw error;
  }
  if (!data) return null;
  return { ...data, title: cleanTitle(data.title) } as BBSThread;
}

// ホーム BBS フィード — visibility='public' のスレッドのみ
// (community_id があっても visibility=public なら出る = community_public 相当の挙動)
// community_only は community 詳細の BBS タブでのみ表示
export async function fetchThreads(): Promise<BBSThread[]> {
  const { data, error } = await supabase
    .from('bbs_threads')
    .select(BBS_THREAD_SELECT_COLS)
    .eq('visibility', 'public')
    .order('last_reply_at', { ascending: false, nullsFirst: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []).map((t: { title: string }) => ({ ...t, title: cleanTitle(t.title) })) as BBSThread[];
}

// 特定コミュニティの BBS スレッド一覧 (community 詳細の BBS タブ用)
// visibility 問わず全件返す — RLS 側で member/非 member 制御
export async function fetchCommunityThreads(
  community_id: string,
  opts: { sort?: 'new' | 'hot' } = {},
): Promise<BBSThread[]> {
  const { sort = 'new' } = opts;
  let query = supabase
    .from('bbs_threads')
    .select(BBS_THREAD_SELECT_COLS)
    .eq('community_id', community_id)
    .limit(100);

  if (sort === 'hot') {
    // hot: 返信数が多い順 → 新しい順
    query = query
      .order('replies_count', { ascending: false })
      .order('last_reply_at', { ascending: false, nullsFirst: false });
  } else {
    // new: 最終返信時刻が新しい順 (返信ゼロは作成時刻にフォールバック)
    query = query.order('last_reply_at', { ascending: false, nullsFirst: false });
  }

  const { data, error } = await query;
  if (error) {
    console.warn('[fetchCommunityThreads] error:', error.message);
    return [];
  }
  return (data ?? []).map((t: { title: string }) => ({ ...t, title: cleanTitle(t.title) })) as BBSThread[];
}

// 既存呼び出し互換のため createThread はそのままシグネチャ維持しつつ
// optional な community_id / visibility を受け付けられる overload を提供
export async function createThread(
  title: string,
  category: string,
  opts?: { community_id?: string; visibility?: ThreadVisibility },
): Promise<BBSThread> {
  const rl = checkRate('bbs_thread');
  if (!rl.ok) throw new Error(rateLimitMessage('bbs_thread', rl.retryAfterMs));
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  // タイトルも sanitize (XSS 対策 + 内部マーカー除去)
  const safeTitle = sanitizeContent(title, { maxLength: 80 });
  if (safeTitle.length < 2) throw new Error('タイトルは 2 文字以上にしてください');

  // community_only は community_id 必須 — そうでないと誰にも見えなくなる
  const visibility: ThreadVisibility = opts?.visibility ?? 'public';
  const community_id = opts?.community_id ?? null;
  if (visibility === 'community_only' && !community_id) {
    throw new Error('コミュニティ限定スレッドにはコミュニティ ID が必要です');
  }

  const { data, error } = await supabase
    .from('bbs_threads')
    .insert({
      title: safeTitle,
      category,
      author_id: user.id,
      community_id,
      visibility,
    })
    .select(BBS_THREAD_SELECT_COLS)
    .single();
  if (error) throw error;
  return data as BBSThread;
}

// BBS スレッドへの返信
//
// 注: profiles への join は FK を明示する必要がある。
// bbs_replies → profiles のリレーションは複数経路あって PostgREST が PGRST201
// (Could not embed: multiple relationships) を返す:
//   1. bbs_replies.author_id → profiles.id (これが欲しい)
//   2. bbs_replies → bbs_reply_reactions → profiles (リアクション経由、欲しくない)
// よって明示的に `profiles!bbs_replies_author_id_fkey` と書く必要がある。
//
// もし将来 FK 名が変わったり、profiles 取得自体が RLS で弾かれた場合に
// スレッドが完全に見えなくなるのを防ぐため、author join 込みで失敗したら
// trust_score 抜きで再取得する 2 段構えにしてある。
export async function fetchReplies(threadId: string): Promise<BBSReply[]> {
  type RawReply = {
    id: string;
    thread_id: string;
    content: string;
    color: string;
    created_at: string;
    author?: { trust_score?: number } | { trust_score?: number }[] | null;
  };

  // 1st try: 著者の trust_score も一緒に取る (FK 明示)
  const withAuthor = await supabase
    .from('bbs_replies')
    .select('id, thread_id, content, color, created_at, author:profiles!bbs_replies_author_id_fkey(trust_score)')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })
    .limit(500);  // DoS 防止: 巨大スレッドで OOM/UI フリーズ防止

  if (!withAuthor.error) {
    return (withAuthor.data ?? []).map((r: RawReply) => {
      const a = Array.isArray(r.author) ? r.author[0] : r.author;
      return {
        id: r.id,
        thread_id: r.thread_id,
        content: r.content,
        color: r.color,
        created_at: r.created_at,
        trust_score: a?.trust_score ?? null,
      } as BBSReply;
    });
  }

  // 著者 join が失敗 → 返信本文だけは絶対に表示できるよう trust_score 抜きで再取得
  console.warn('[fetchReplies] author join failed, falling back without trust_score:', withAuthor.error.message);
  const fallback = await supabase
    .from('bbs_replies')
    .select('id, thread_id, content, color, created_at')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })
    .limit(500);  // DoS 防止: 巨大スレッドで OOM/UI フリーズ防止
  if (fallback.error) throw fallback.error;
  return (fallback.data ?? []).map((r) => ({
    id: r.id,
    thread_id: r.thread_id,
    content: r.content,
    color: r.color,
    created_at: r.created_at,
    trust_score: null,
  })) as BBSReply[];
}

export async function createReply(threadId: string, content: string): Promise<void> {
  const rl = checkRate('bbs_reply');
  if (!rl.ok) throw new Error(rateLimitMessage('bbs_reply', rl.retryAfterMs));
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const safeContent = sanitizeContent(content, { maxLength: 1000 });
  if (!safeContent) throw new Error('内容を入力してください');
  const color = `hsl(${Math.floor(Math.random() * 360)}, 60%, 70%)`;
  const { error } = await supabase
    .from('bbs_replies')
    .insert({ thread_id: threadId, content: safeContent, color, author_id: user.id });
  if (error) throw error;
}

// 投稿へのコメント（BBS返信とは別テーブル）
// fetchReplies と同じ PGRST201 リスクがあるので FK 明示 + フォールバック構成
export async function fetchComments(postId: string): Promise<Comment[]> {
  type RawComment = {
    id: string;
    post_id: string;
    content: string;
    avatar_color: string;
    created_at: string;
    author?: { trust_score?: number } | { trust_score?: number }[] | null;
  };

  const withAuthor = await supabase
    .from('comments')
    .select('id, post_id, content, avatar_color, created_at, author:profiles!comments_author_id_fkey(trust_score)')
    .eq('post_id', postId)
    .order('created_at', { ascending: true });

  if (!withAuthor.error) {
    return (withAuthor.data ?? []).map((c: RawComment) => {
      const a = Array.isArray(c.author) ? c.author[0] : c.author;
      return {
        id: c.id,
        post_id: c.post_id,
        content: c.content,
        avatar_color: c.avatar_color,
        created_at: c.created_at,
        trust_score: a?.trust_score ?? null,
      } as Comment;
    });
  }

  console.warn('[fetchComments] author join failed, falling back:', withAuthor.error.message);
  const fallback = await supabase
    .from('comments')
    .select('id, post_id, content, avatar_color, created_at')
    .eq('post_id', postId)
    .order('created_at', { ascending: true });
  if (fallback.error) throw fallback.error;
  return (fallback.data ?? []).map((c) => ({
    id: c.id,
    post_id: c.post_id,
    content: c.content,
    avatar_color: c.avatar_color,
    created_at: c.created_at,
    trust_score: null,
  })) as Comment[];
}

export async function createComment(postId: string, content: string): Promise<void> {
  const rl = checkRate('comment');
  if (!rl.ok) throw new Error(rateLimitMessage('comment', rl.retryAfterMs));
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const safeContent = sanitizeContent(content, { maxLength: 500 });
  if (!safeContent) throw new Error('内容を入力してください');
  const color = `hsl(${Math.floor(Math.random() * 360)}, 60%, 70%)`;
  const { error } = await supabase
    .from('comments')
    .insert({ post_id: postId, content: safeContent, avatar_color: color, author_id: user.id });
  if (error) throw error;
}
