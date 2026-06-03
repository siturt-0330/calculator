import { supabase } from '../supabase';
import { withApiTimeout } from '../withApiTimeout';
import type { BBSThread, BBSReply, ThreadVisibility } from '../../types/models';
import { sanitizeContent } from '../sanitize';
import { checkRate, rateLimitMessage } from '../rateLimit';

export type { ThreadVisibility } from '../../types/models';

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
  const { data, error } = await withApiTimeout(
    supabase
      .from('bbs_threads')
      .select(BBS_THREAD_SELECT_COLS)
      .eq('id', id)
      .maybeSingle(),
    'bbs.fetchThread',
    8000,
  );
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
  const { data, error } = await withApiTimeout(
    supabase
      .from('bbs_threads')
      .select(BBS_THREAD_SELECT_COLS)
      .eq('visibility', 'public')
      .order('last_reply_at', { ascending: false, nullsFirst: false })
      .limit(50),
    'bbs.fetchThreads',
    8000,
  );
  if (error) throw error;
  return (data ?? []).map((t: { title: string }) => ({ ...t, title: cleanTitle(t.title) })) as BBSThread[];
}

// 自分が参加している全コミュニティの BBS スレッドを横断取得
// ============================================================
// 用途: 掲示板タブの「コミュニティ」スコープ。
// 流れ:
//   1. community_members から自分の community_id 一覧を取得
//   2. bbs_threads.community_id IN (myIds) で一括 fetch
//   3. last_reply_at desc でソート (返信ゼロは created_at fallback)
// 戻り値の hasJoinedCommunities は empty state の出し分けに使う:
//   - false: 「コミュニティに参加しよう」CTA を出す
//   - true (& threads.length === 0): 「まだスレッドがありません」案内
export async function fetchMyJoinedCommunityThreads(
  limit = 80,
): Promise<{ threads: BBSThread[]; hasJoinedCommunities: boolean }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { threads: [], hasJoinedCommunities: false };

  // 1) 自分の所属 community_id
  const { data: memberRows, error: memErr } = await withApiTimeout(
    supabase
      .from('community_members')
      .select('community_id')
      .eq('user_id', user.id),
    'bbs.fetchMyJoinedCommunityThreads.members',
    8000,
  );
  if (memErr) {
    console.warn('[bbs] fetchMyJoinedCommunityThreads (members) failed:', memErr.message);
    return { threads: [], hasJoinedCommunities: false };
  }
  const myCommunityIds = (memberRows ?? []).map((r) => r.community_id);
  if (myCommunityIds.length === 0) {
    return { threads: [], hasJoinedCommunities: false };
  }

  // 2) その community_id に属するスレッド (visibility 制御は RLS)
  const { data: threadRows, error: threadErr } = await withApiTimeout(
    supabase
      .from('bbs_threads')
      .select(BBS_THREAD_SELECT_COLS)
      .in('community_id', myCommunityIds)
      .order('last_reply_at', { ascending: false, nullsFirst: false })
      .limit(limit),
    'bbs.fetchMyJoinedCommunityThreads.threads',
    8000,
  );
  if (threadErr) {
    console.warn('[bbs] fetchMyJoinedCommunityThreads (threads) failed:', threadErr.message);
    return { threads: [], hasJoinedCommunities: true };
  }
  const threads = (threadRows ?? []).map((t: { title: string }) => ({
    ...t,
    title: cleanTitle(t.title),
  })) as BBSThread[];
  return { threads, hasJoinedCommunities: true };
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

  const { data, error } = await withApiTimeout(query, 'bbs.fetchCommunityThreads', 8000);
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
    author_id: string;  // スレ内 ID 表示用 (lib/utils/threadUserId で hash)
    author?: { trust_score?: number } | { trust_score?: number }[] | null;
  };

  // 1st try: 著者の trust_score + author_id も一緒に取る (FK 明示)
  // author_id は RLS bbs_replies_read for select using(true) で公開済なので
  // SELECT に含めても新規 disclosure ではない。スレ内 ID hash 表示のため必須。
  // timeout-throw は author join 失敗と同じ扱いにして fallback に流す。
  let withAuthor: { data: RawReply[] | null; error: { message?: string } | null };
  try {
    const res = await withApiTimeout(
      supabase
        .from('bbs_replies')
        .select('id, thread_id, content, color, created_at, author_id, author:profiles!bbs_replies_author_id_fkey(trust_score)')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: true })
        .limit(500),  // DoS 防止: 巨大スレッドで OOM/UI フリーズ防止
      'bbs.fetchReplies.withAuthor',
      8000,
    );
    withAuthor = { data: res.data as unknown as RawReply[] | null, error: res.error };
  } catch (e) {
    withAuthor = { data: null, error: e as { message?: string } };
  }

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
        author_id: r.author_id,
      } as BBSReply;
    });
  }

  // 著者 join が失敗 → 返信本文だけは絶対に表示できるよう trust_score 抜きで再取得
  console.warn('[fetchReplies] author join failed, falling back without trust_score:', withAuthor.error.message);
  const fallback = await withApiTimeout(
    supabase
      .from('bbs_replies')
      .select('id, thread_id, content, color, created_at, author_id')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true })
      .limit(500),  // DoS 防止: 巨大スレッドで OOM/UI フリーズ防止
    'bbs.fetchReplies.fallback',
    8000,
  );
  if (fallback.error) throw fallback.error;
  return (fallback.data ?? []).map((r) => ({
    id: r.id,
    thread_id: r.thread_id,
    content: r.content,
    color: r.color,
    created_at: r.created_at,
    trust_score: null,
    author_id: r.author_id,
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

// ============================================================
// 投稿コメント (public.comments) は lib/api/comments.ts に切り出し
// ------------------------------------------------------------
// 0059 でコメントツリー化 (parent_comment_id / reply_to_comment_id) を
// 入れたタイミングで実装ファイルを分離した。既存の `import { fetchComments,
// createComment } from '../lib/api/bbs'` は壊さないよう、ここで re-export する。
// 新規 component / hook は直接 `lib/api/comments` から import するのが推奨。
// ============================================================
export { fetchComments, createComment } from './comments';
export type { CreateCommentOpts } from './comments';

// ============================================================
// Best ソート (post コメント用 — Reddit 風 score)
// ------------------------------------------------------------
// 実装は副作用なし pure helper として lib/utils/commentBestScore.ts に隔離
// (supabase 依存のこの file に書くと Jest の transformIgnore で parse error
// になるため)。呼出側は bbs.ts から従来通り import できるよう re-export。
// ============================================================
export {
  computeCommentBestScore,
  sortCommentsByBest,
} from '../utils/commentBestScore';
export type { CommentLike } from '../utils/commentBestScore';
