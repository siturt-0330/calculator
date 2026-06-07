// ============================================================
// lib/api/comments.ts — 投稿コメント (public.comments) の Supabase クエリ層
// ------------------------------------------------------------
// コメントツリー (migration 0059) の parent_comment_id / reply_to_comment_id に
// 加え、メディア添付 (migration 0104, comments.media_urls text[]) を扱う。
//
// - bbs.ts からの import は壊さないよう、bbs.ts 側で re-export している。
// - createComment は overload 互換のため第 3 引数 opts を optional に。
//   opts.parentId  → parent_comment_id (ツリー親)
//   opts.replyToId → reply_to_comment_id (メンション宛先 / 通知 trigger)
//   opts.mediaUrls → media_urls (添付メディアの公開 URL 配列)
// - SELECT は media 列が無い環境 (0104 未適用) でも壊れないよう段階 fallback。
// ============================================================

import { supabase } from '../supabase';
import { withApiTimeout } from '../withApiTimeout';
import type { Comment } from '../../types/models';
import { sanitizeContent } from '../sanitize';
import { checkRate, rateLimitMessage } from '../rateLimit';

// ============================================================
// deleteComment — 自分のコメントを削除する (author 本人のみ)
// ------------------------------------------------------------
// RLS: comments_delete = `auth.uid() = author_id OR <mod>` (0068)。本人は削除可。
// hard delete。counters (posts.comments_count / profiles.comment_count) は DB
// トリガで自動減算。`.select('id')` で実削除を確認し RLS 0 行 delete の誤 success を防ぐ。
// ============================================================
export async function deleteComment(commentId: string): Promise<void> {
  const { data, error } = await withApiTimeout(
    supabase.from('comments').delete().eq('id', commentId).select('id'),
    'comments.delete',
    8000,
  );
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('削除できませんでした (権限が無いか、既に削除済みです)');
  }
}

// SELECT カラム — media 有 / 無 の 2 種類。列未適用環境では media 無し版で取る。
// ★ de-anon Phase2: REST fallback tier も author_id を SELECT しない (REVOKE 後も安全)。
//   own/mod 判定は RPC tier の is_own / server RLS に一本化したため、この tier では
//   author_id は不要 (mapRow も載せない)。
const COMMENT_SELECT_COLS_BASE =
  'id, post_id, content, avatar_color, created_at, parent_comment_id, reply_to_comment_id';
const COMMENT_SELECT_COLS_MEDIA = `${COMMENT_SELECT_COLS_BASE}, media_urls`;

type RawComment = {
  id: string;
  post_id: string;
  content: string;
  avatar_color: string;
  created_at: string;
  parent_comment_id: string | null;
  reply_to_comment_id: string | null;
  media_urls?: string[] | null;
  author?: { trust_score?: number } | { trust_score?: number }[] | null;
};

// ★ de-anon Phase2: legacy REST tier (1-3) は author_id を SELECT し得るが、
//   client の Comment には author_id を載せない (own/mod 判定は is_own / RLS へ)。
//   この tier では de-anon フィールド (avatar_url / avatar_emoji / pseudonym_id /
//   is_own) は供給されないため undefined のまま (RPC tier 0 でのみ揃う)。
function mapRow(c: RawComment): Comment {
  const a = Array.isArray(c.author) ? c.author[0] : c.author;
  return {
    id: c.id,
    post_id: c.post_id,
    content: c.content,
    avatar_color: c.avatar_color,
    created_at: c.created_at,
    parent_comment_id: c.parent_comment_id,
    reply_to_comment_id: c.reply_to_comment_id,
    media_urls: Array.isArray(c.media_urls) ? c.media_urls : null,
    trust_score: a?.trust_score ?? null,
  } as Comment;
}

// ============================================================
// de-anon Phase2 — get_post_comments RPC (0125) の生 row。
//   server 側で author_id をマスクし、擬似アイデンティティ表示に必要な
//   avatar_url / avatar_emoji / pseudonym_id と、own 判定用 is_own を供給する。
// ============================================================
type RpcCommentRow = {
  id: string;
  post_id: string;
  content: string;
  avatar_color: string;
  created_at: string;
  parent_comment_id: string | null;
  reply_to_comment_id: string | null;
  media_urls?: string[] | null;
  trust_score?: number | null;
  avatar_url?: string | null;
  avatar_emoji?: string | null;
  pseudonym_id?: string | null;
  is_own?: boolean | null;
};

function mapRpcRow(c: RpcCommentRow): Comment {
  return {
    id: c.id,
    post_id: c.post_id,
    content: c.content,
    avatar_color: c.avatar_color,
    created_at: c.created_at,
    parent_comment_id: c.parent_comment_id ?? null,
    reply_to_comment_id: c.reply_to_comment_id ?? null,
    media_urls: Array.isArray(c.media_urls) ? c.media_urls : null,
    trust_score: c.trust_score ?? null,
    avatar_url: c.avatar_url ?? null,
    avatar_emoji: c.avatar_emoji ?? null,
    pseudonym_id: c.pseudonym_id ?? null,
    is_own: !!c.is_own,
  } as Comment;
}

// DoS 防止: 1 post に対する comment は上限 500 件で打ち切り。
const FETCH_COMMENTS_LIMIT = 500;

// withApiTimeout は timeout 時に throw する ({error} を返さない)。tier cascade を壊さない
// よう、throw を既存の {data,error} フローへ正規化する小 helper。timeout は「その tier が
// 失敗した」と同義に扱い、次の tier へ fall-through させる (tier3 は呼び出し側で rethrow)。
async function safeRead<T>(
  p: PromiseLike<{ data: T | null; error: { message?: string } | null }>,
  label: string,
): Promise<{ data: T | null; error: { message?: string } | null }> {
  try {
    return await withApiTimeout(p, label, 8000);
  } catch (e) {
    return { data: null, error: e as { message?: string } };
  }
}

// 投稿へのコメント取得 — 4 段 fallback:
//   0) ★ de-anon Phase2: get_post_comments RPC (0125)。author_id をマスクしつつ
//      avatar_url / avatar_emoji / pseudonym_id / is_own を供給する (擬似アイデンティティ
//      表示 + own 判定が author_id 非依存になる正経路)。RPC 未適用なら次 tier へ。
//   1) media + author(trust_score) join (REST fallback — de-anon フィールドは付かない)
//   2) media のみ (author join が PGRST201 で壊れた時も media は保つ)
//   3) base のみ (media_urls 列が無い = migration 0104 未適用 の環境)
// 各 tier を withApiTimeout(8s) で bound し、timeout も「その tier 失敗」として次へ流す。
export async function fetchComments(postId: string): Promise<Comment[]> {
  // tier0: de-anon RPC。{ comments: RpcCommentRow[] } を返す。
  const t0 = await safeRead<{ comments?: RpcCommentRow[] } | null>(
    supabase.rpc('get_post_comments', { p_post_id: postId }),
    'comments.fetch.tier0.rpc',
  );
  if (!t0.error) {
    const payload = t0.data ?? { comments: [] };
    const rows = Array.isArray(payload?.comments) ? payload.comments : [];
    return rows.map((c) => mapRpcRow(c));
  }
  console.warn('[fetchComments] tier0 (get_post_comments rpc) failed → REST tiers:', t0.error.message);

  const t1 = await safeRead<RawComment[]>(
    supabase
      .from('comments')
      .select(`${COMMENT_SELECT_COLS_MEDIA}, author:profiles!comments_author_id_fkey(trust_score)`)
      .eq('post_id', postId)
      .order('created_at', { ascending: true })
      .limit(FETCH_COMMENTS_LIMIT),
    'comments.fetch.tier1',
  );
  if (!t1.error) return (t1.data ?? []).map((c: RawComment) => mapRow(c));

  console.warn('[fetchComments] tier1 (media+author) failed → media-only:', t1.error.message);
  const t2 = await safeRead<RawComment[]>(
    supabase
      .from('comments')
      .select(COMMENT_SELECT_COLS_MEDIA)
      .eq('post_id', postId)
      .order('created_at', { ascending: true })
      .limit(FETCH_COMMENTS_LIMIT),
    'comments.fetch.tier2',
  );
  if (!t2.error) return (t2.data ?? []).map((c: RawComment) => mapRow(c));

  console.warn('[fetchComments] tier2 (media) failed → base-only:', t2.error.message);
  const t3 = await safeRead<RawComment[]>(
    supabase
      .from('comments')
      .select(COMMENT_SELECT_COLS_BASE)
      .eq('post_id', postId)
      .order('created_at', { ascending: true })
      .limit(FETCH_COMMENTS_LIMIT),
    'comments.fetch.tier3',
  );
  if (t3.error) throw t3.error;
  return (t3.data ?? []).map((c: RawComment) => mapRow(c));
}

export type CreateCommentOpts = {
  parentId?: string | null;       // ツリー親 comment.id (なければ root として作る)
  replyToId?: string | null;       // メンション宛先 comment.id (notify trigger 起動)
  mediaUrls?: string[] | null;     // 添付メディアの公開 URL (migration 0104)
};

// 投稿への新規コメント。第 3 引数 opts は optional。
// メディアのみ (本文空) のコメントも migration 0104 適用後は許可する。
export async function createComment(
  postId: string,
  content: string,
  opts: CreateCommentOpts = {},
): Promise<void> {
  const rl = checkRate('comment');
  if (!rl.ok) throw new Error(rateLimitMessage('comment', rl.retryAfterMs));
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const safeContent = sanitizeContent(content, { maxLength: 1000 });
  const media = (opts.mediaUrls ?? []).filter(
    (u): u is string => typeof u === 'string' && u.length > 0,
  );
  // 本文・メディアどちらも無ければ拒否 (メディアのみコメントは許可)
  if (!safeContent && media.length === 0) throw new Error('内容を入力してください');
  const color = `hsl(${Math.floor(Math.random() * 360)}, 60%, 70%)`;

  const row: {
    post_id: string;
    content: string;
    avatar_color: string;
    author_id: string;
    parent_comment_id?: string | null;
    reply_to_comment_id?: string | null;
    media_urls?: string[];
  } = {
    post_id: postId,
    content: safeContent,
    avatar_color: color,
    author_id: user.id,
  };
  if (opts.parentId) row.parent_comment_id = opts.parentId;
  if (opts.replyToId) row.reply_to_comment_id = opts.replyToId;
  // media_urls は付与時のみ含める (列未適用環境で text コメントを壊さないため)
  if (media.length > 0) row.media_urls = media;

  const { error } = await supabase.from('comments').insert(row);
  if (error) throw error;
}

// ============================================================
// fetchMyComments — マイページ「コメント」タブ用: 自分が残したコメント一覧
// ------------------------------------------------------------
// 「あなたが他の投稿に残した声」を出典 (post) 付きで時系列降順に取得する。
// fetchComments と同じ safeRead(withApiTimeout 8s) + 段階 fallback を写経:
//   tier1 (推奨): comments + media + post embed を 1 RTT で取得
//   tier2: embed が PGRST200/201 等で壊れた時、post embed を base 列 (media 抜き) に
//   ★tier3 (FK 非依存の安全網・必須): comments を embed 無しで取得 → 得た post_id を
//          posts.in('id', ids) で 2 段 fetch し Map で post を復元 (= saved と同型)。
//          FK 名 comments_post_id_fkey が実在しない / media_urls 列が無い (0104 未適用)
//          環境でも確実に動き、コメントが silent に全消滅する地雷を回避する。
//          (実コード上 FK 実在は comments_author_id_fkey のみ確認済 = post embed は未実証)
// author_visible RLS は自分のコメントには無影響 (必ず読める)。返却は created_at desc。
// ============================================================

export type MyCommentRow = {
  id: string;
  post_id: string;
  content: string;
  created_at: string;
  media_urls: string[] | null;
  post: {
    id: string;
    title: string | null;
    content: string;
    media_urls: string[] | null;
  } | null;
};

// 自分のコメント取得の上限 (初回ペイロード軽量化。専用一覧があれば別途ページング)
const FETCH_MY_COMMENTS_LIMIT = 50;

// embed (post:posts!comments_post_id_fkey) を含む tier1/tier2 の生 shape。
// PostgREST の to-one embed は object だが、FK 不定で配列化することもあるため両対応。
type RawEmbeddedPost = {
  id: string;
  title: string | null;
  content: string;
  media_urls?: string[] | null;
} | null;

type RawMyComment = {
  id: string;
  post_id: string;
  content: string;
  created_at: string;
  media_urls?: string[] | null;
  post?: RawEmbeddedPost | RawEmbeddedPost[];
};

// embed 結果を MyCommentRow.post (単一 or null) に正規化。
function normalizePost(p: RawMyComment['post']): MyCommentRow['post'] {
  const one = Array.isArray(p) ? p[0] : p;
  if (!one) return null;
  return {
    id: one.id,
    title: one.title ?? null,
    content: one.content,
    media_urls: Array.isArray(one.media_urls) ? one.media_urls : null,
  };
}

function mapMyComment(c: RawMyComment): MyCommentRow {
  return {
    id: c.id,
    post_id: c.post_id,
    content: c.content,
    created_at: c.created_at,
    media_urls: Array.isArray(c.media_urls) ? c.media_urls : null,
    post: normalizePost(c.post),
  };
}

export async function fetchMyComments(
  userId: string,
  opts?: { limit?: number },
): Promise<MyCommentRow[]> {
  const limit = opts?.limit ?? FETCH_MY_COMMENTS_LIMIT;

  // tier1: media + post embed を 1 RTT で。
  const t1 = await safeRead<RawMyComment[]>(
    supabase
      .from('comments')
      .select(
        'id, post_id, content, created_at, media_urls, post:posts!comments_post_id_fkey(id, title, content, media_urls)',
      )
      .eq('author_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit),
    'comments.fetchMine.tier1',
  );
  if (!t1.error) return (t1.data ?? []).map(mapMyComment);

  // tier2: embed の media を落として base 列のみ embed (post.media_urls 欠落時の退避)。
  console.warn('[fetchMyComments] tier1 (embed+media) failed → embed base:', t1.error.message);
  const t2 = await safeRead<RawMyComment[]>(
    supabase
      .from('comments')
      .select(
        'id, post_id, content, created_at, media_urls, post:posts!comments_post_id_fkey(id, title, content)',
      )
      .eq('author_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit),
    'comments.fetchMine.tier2',
  );
  if (!t2.error) return (t2.data ?? []).map(mapMyComment);

  // ★tier3 (FK 非依存の安全網): comments を embed/media 無しで取得 → posts.in で 2 段 fetch。
  // comment 側 media_urls は取れない環境なので null 埋め。created_at desc は postIds 順で保持。
  console.warn('[fetchMyComments] tier2 (embed base) failed → 2-step posts.in:', t2.error.message);
  const t3 = await safeRead<
    { id: string; post_id: string; content: string; created_at: string }[]
  >(
    supabase
      .from('comments')
      .select('id, post_id, content, created_at')
      .eq('author_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit),
    'comments.fetchMine.tier3.comments',
  );
  if (t3.error) throw t3.error;
  const rows = t3.data ?? [];
  if (rows.length === 0) return [];

  // 出典 post を別 fetch (saves → posts と同型)。重複 post_id は uniq 化して 1 回で引く。
  const postIds = Array.from(new Set(rows.map((r) => r.post_id)));
  const tp = await safeRead<
    { id: string; title: string | null; content: string; media_urls: string[] | null }[]
  >(
    supabase.from('posts').select('id, title, content, media_urls').in('id', postIds),
    'comments.fetchMine.tier3.posts',
  );
  // posts 取得が失敗しても自分のコメント本文は誇れる → post=null で返す (silent 消滅は回避)。
  if (tp.error) {
    console.warn('[fetchMyComments] tier3 posts.in failed → post=null:', tp.error.message);
  }
  const postMap = new Map(
    (tp.data ?? []).map((p) => [
      p.id,
      {
        id: p.id,
        title: p.title ?? null,
        content: p.content,
        media_urls: Array.isArray(p.media_urls) ? p.media_urls : null,
      },
    ]),
  );

  // comments の created_at desc 順を維持したまま post を Map で復元。
  return rows.map((c) => ({
    id: c.id,
    post_id: c.post_id,
    content: c.content,
    created_at: c.created_at,
    media_urls: null,
    post: postMap.get(c.post_id) ?? null,
  }));
}
