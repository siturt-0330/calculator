import { supabase } from '../supabase';
import { withApiTimeout } from '../withApiTimeout';
import type { Post, PostVisibility } from '../../types/models';

export type { PostVisibility } from '../../types/models';
// 'rising' = Reddit 風 "急上昇" — 直近 3h 内で likes/min が高い post を上位に。
//   server 側は実質 'new' (created_at desc limit 100) で取得し、
//   client 側 (hooks/useFeed) で lib/utils/risingScore.ts により再ランクする。
//   RPC/DB スキーマ変更不要。詳細は risingScore.ts のヘッダコメント参照。
export type SortMode = 'for-you' | 'hot' | 'new' | 'top' | 'rising';

// posts SELECT で取得するカラム一覧 (一箇所でメンテ可能)
// author_id は公式コミュ管理者投稿を de-anonymize する判定に使う (RLS で誰でも読める)
const POSTS_SELECT_COLS =
  'id, content, title, last_activity_at, media_urls, media_blurhashes, video_urls, video_posters, tag_names, likes_count, comments_count, score, hot_score, concern_count, kind, source_url, is_public, trust_score_at_post, is_anonymous, content_warning, cw_category, visibility, qa_mode, created_at, author_id';

// posts + post_communities + communities を 1 RTT で取得するための embed セット。
// attachOfficialAuthor が必要としていた 2nd round-trip を畳み込み、
// フィード描画の round-trip を半減させる。
// 失敗時 (PostgREST schema cache 等) は legacy 2-step に自動 fallback。
const POSTS_SELECT_COLS_WITH_COMM = `${POSTS_SELECT_COLS}, post_communities(community:communities(is_official, official_admin_user_id, official_admin_display_name, official_organization))`;

// embed 結果 → official_author 派生フィールドを posts[] に書き戻すヘルパ。
// (attachOfficialAuthor の純粋関数版 — supabase fetch なし)
type EmbeddedCommunityRow = {
  is_official?: boolean | null;
  official_admin_user_id?: string | null;
  official_admin_display_name?: string | null;
  official_organization?: string | null;
};
type PostWithEmbeddedComm = Post & {
  post_communities?:
    | Array<{ community: EmbeddedCommunityRow | EmbeddedCommunityRow[] | null }>
    | null;
};

// ============================================================
// deleteOwnPost — 自分の投稿を削除する (author 本人のみ)
// ------------------------------------------------------------
// RLS: posts_delete = `auth.uid() = author_id` なので本人のみ削除可能。
// hard delete。子行 (comments/saves/reactions/post_communities) は FK
// ON DELETE CASCADE、counters (comments_count / profiles.post_count) は DB
// トリガで自動減算されるため、ここでの手動減算は不要。
// ★ `.select('id')` で実際に削除された行を確認する。RLS で 0 行 delete は
//   error にならないため、これが無いと「権限なし」を success と誤報してしまう。
// ============================================================
export async function deleteOwnPost(postId: string): Promise<void> {
  const { data, error } = await withApiTimeout(
    supabase.from('posts').delete().eq('id', postId).select('id'),
    'posts.deleteOwn',
    8000,
  );
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('削除できませんでした (権限が無いか、既に削除済みです)');
  }
}

function attachOfficialAuthorFromEmbed<T extends Post>(
  rawPosts: PostWithEmbeddedComm[],
): T[] {
  return rawPosts.map((p) => {
    // post_communities embed (RLS で見れない場合は null/[])
    const pcs = Array.isArray(p.post_communities) ? p.post_communities : [];
    let official: { name: string; organization: string } | undefined;
    for (const pc of pcs) {
      const raw = pc.community;
      if (!raw) continue;
      const c = Array.isArray(raw) ? raw[0] : raw;
      if (!c || !c.is_official || !c.official_admin_user_id) continue;
      if (!p.author_id || p.author_id !== c.official_admin_user_id) continue;
      official = {
        name: c.official_admin_display_name ?? '',
        organization: c.official_organization ?? '',
      };
      break; // 最初に該当する公式コミュ管理者を採用
    }
    // embed フィールド (post_communities) を返却 shape から落として Post 型に揃える
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { post_communities: _ignored, ...rest } = p;
    if (official) {
      return { ...(rest as Post), official_author: official } as T;
    }
    return rest as T;
  });
}

// PostgREST が embed をサポートしていない / RLS で permission denied 等で
// fail した場合に true を返す判定。embed 文字列を含む / 'relationship' 系の
// エラーは fallback で legacy パスに戻す。
function isEmbedFailure(err: unknown): boolean {
  if (!err) return false;
  const msg = (err as { message?: string }).message ?? '';
  if (/post_communities/i.test(msg) && /(could not|cache|relationship)/i.test(msg)) {
    return true;
  }
  // PGRST200 = "could not find relationship"
  const code = (err as { code?: string }).code ?? '';
  if (code === 'PGRST200' || code === 'PGRST201') return true;
  return false;
}

// UUID 形式チェック (壊れた URL や古い ID 対策) — fetchPostById と fetchCommunityPosts で使う
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type FetchPostsOpts = {
  sort?: SortMode;
  likedTags: string[];
  blockedTags: string[];
  cursor?: string;
  limit?: number;
  filterTags?: string[];
  // home フィード (default true) — visibility が 'public' / 'community_public' の post だけ表示
  // (private は本人以外、community_only はコミュニティ詳細でのみ)
  home?: boolean;
};

export async function fetchPosts({
  sort = 'hot',
  blockedTags,
  cursor,
  limit = 20,
  filterTags,
  home = true,
}: FetchPostsOpts): Promise<{ posts: Post[]; nextCursor: string | null }> {
  // 'for-you' は内部的に 'hot' と同じ広い候補プールを取りつつ、クライアント側で
  // パーソナライズ再ランクするので、候補数を 1.5x にしてランカー側に余白を与える。
  // 'rising' は 'new' の created_at desc を引数 100 件で取得し、client 側で
  // likes/分 速度で再ランク → 上位 30 を表示。ページングはせず 1 ページのみ。
  const isForYou = sort === 'for-you';
  const isRising = sort === 'rising';
  const RISING_FETCH_LIMIT = 100;
  const effectiveLimit = isForYou
    ? Math.ceil(limit * 1.5)
    : isRising
      ? RISING_FETCH_LIMIT
      : limit;
  const effectiveSort: 'hot' | 'new' | 'top' = isForYou
    ? 'hot'
    : isRising
      ? 'new'
      : sort;

  // 1 RTT で post + 公式コミュ管理者情報を取得するため、post_communities embed を含む
  // SELECT を使う。embed 失敗時のみ legacy パス (POSTS_SELECT_COLS + attachOfficialAuthor)
  // にフォールバック。
  let query = supabase
    .from('posts')
    .select(POSTS_SELECT_COLS_WITH_COMM)
    .eq('is_anonymous', true)
    .eq('is_public', true)
    .limit(effectiveLimit);

  // ホームフィード: visibility が public / community_public のもののみ
  // (private は本人専用、community_only はコミュニティ詳細でしか出さない)
  // 既存 posts (visibility カラムが NULL の可能性ゼロ — default 'public' で backfill 済)
  if (home) {
    query = query.in('visibility', ['public', 'community_public']);
  }

  // PostgREST の URL 長さ制限 (≒8KB) 対策:
  // サーバー側で除外できるのは先頭 80 個まで。残りはクライアント側で smartSort
  // 経由で弾いている (lib/feed/smartRank.ts の blockedSet 判定)。
  // これで 92+ blocked tags でも URL が肥大化して 414 にならない。
  if (blockedTags.length > 0) {
    const SERVER_LIMIT = 80;
    const serverSide = blockedTags.length > SERVER_LIMIT
      ? blockedTags.slice(0, SERVER_LIMIT)
      : blockedTags;
    query = query.not('tag_names', 'cs', `{${serverSide.join(',')}}`);
  }

  if (filterTags && filterTags.length > 0) {
    query = query.overlaps('tag_names', filterTags);
  }

  // cursor 検証ヘルパ — 不正な cursor で偽 pagination が動くのを防ぐ
  // 期待フォーマット:
  //   new mode:        ISO timestamp (e.g. '2026-05-19T12:34:56.789Z')
  //   top mode:        '<integer>|<ISO timestamp>'   e.g. '42|2026-05-19T12:34:56.789Z'
  //   hot mode:        '<float>|<ISO timestamp>'     e.g. '4.213|2026-05-19T12:34:56.789Z'
  //                    (hot は hot_score = double precision なので浮動小数を受け付ける)
  const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function parseTimestampCursor(c: string): string | null {
    return ISO_RE.test(c) ? c : null;
  }
  // new sort 用 composite cursor: '<ISO timestamp>|<uuid>'
  // 同じ created_at の post が複数存在する場合 (高頻度投稿環境で発生) に
  // 1 ページ目と 2 ページ目で同じ post が出る/欠落する境界バグを防ぐ (Audit D #6)。
  // 旧 cursor (ISO timestamp 単体) は parseTimestampCursor で fallback 受付。
  function parseNewCompositeCursor(c: string): { ts: string; id: string } | null {
    const parts = c.split('|');
    if (parts.length !== 2) return null;
    const ts = parts[0];
    const id = parts[1];
    if (!ts || !id) return null;
    if (!ISO_RE.test(ts)) return null;
    if (!UUID_RE.test(id)) return null;
    return { ts, id };
  }
  function parseCompositeCursor(c: string): { likes: number; ts: string } | null {
    const parts = c.split('|');
    if (parts.length !== 2) return null;
    const likesStr = parts[0];
    const ts = parts[1];
    if (!likesStr || !ts) return null;
    // likes_count は正整数 (0 以上、INT4 上限以下)
    if (!/^\d{1,10}$/.test(likesStr)) return null;
    const likes = Number(likesStr);
    if (!Number.isFinite(likes) || likes < 0 || likes > 2147483647) return null;
    if (!ISO_RE.test(ts)) return null;
    return { likes, ts };
  }
  // hot 用 cursor: hot_score (double precision, 負値あり) + ISO timestamp
  // 値域は double precision そのものなので、数値表記を緩めに許可しつつ
  // Number.isFinite で最終チェック。
  function parseHotCursor(c: string): { hot: number; ts: string } | null {
    const parts = c.split('|');
    if (parts.length !== 2) return null;
    const hotStr = parts[0];
    const ts = parts[1];
    if (!hotStr || !ts) return null;
    // -123.456 / 0 / 7.89e-3 / -1.5e+10 など。NaN/Infinity は弾く。
    if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(hotStr)) return null;
    const hot = Number(hotStr);
    if (!Number.isFinite(hot)) return null;
    if (!ISO_RE.test(ts)) return null;
    return { hot, ts };
  }

  // ----------------------------------------------------------------
  // hot は hot_score (generated column, 0058_hot_score.sql) で並べる。
  // 環境によっては migration 未 apply で column が無いケースがあるので
  // legacy fallback (likes_count desc, created_at desc) を用意し、
  // 「column does not exist」エラーで自動切替する。
  // ----------------------------------------------------------------
  const isHot = effectiveSort === 'hot';

  if (effectiveSort === 'new') {
    // 同 created_at の post の境界バグ防止: secondary key として id desc を入れる。
    // PostgreSQL の order は決定的になるので、cursor の境界で post の重複/欠落が起きない。
    query = query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false });
    if (cursor) {
      // 1) 新形式 composite '<ts>|<id>': created_at の同値境界を id で tie-break
      const parsedComposite = parseNewCompositeCursor(cursor);
      if (parsedComposite) {
        query = query.or(
          `created_at.lt.${parsedComposite.ts},and(created_at.eq.${parsedComposite.ts},id.lt.${parsedComposite.id})`,
        );
      } else {
        // 2) 旧形式 (ISO timestamp 単体) — 後方互換のため受け付ける
        const validTs = parseTimestampCursor(cursor);
        if (validTs) query = query.lt('created_at', validTs);
        // 不正なら cursor を無視して先頭から (DoS 防止 — error throw だと無限リロード起こす)
      }
    }
  } else if (effectiveSort === 'top') {
    query = query.order('likes_count', { ascending: false }).order('created_at', { ascending: false });
    if (cursor) {
      const parsed = parseCompositeCursor(cursor);
      if (parsed) {
        query = query.or(`likes_count.lt.${parsed.likes},and(likes_count.eq.${parsed.likes},created_at.lt.${parsed.ts})`);
      }
    }
  } else {
    // hot: Reddit 風 hot_score (= log10(|s|) + sign(s)*t/28800) で並べる。
    // generated column が未 apply な環境 (= 旧 schema) では下のエラー検知 → fallback。
    query = query
      .order('hot_score', { ascending: false })
      .order('created_at', { ascending: false });
    if (cursor) {
      const parsed = parseHotCursor(cursor);
      if (parsed) {
        // hot_score < parsed.hot OR (hot_score = parsed.hot AND created_at < parsed.ts)
        query = query.or(
          `hot_score.lt.${parsed.hot},and(hot_score.eq.${parsed.hot},created_at.lt.${parsed.ts})`,
        );
      }
    }
  }

  let { data, error } = await withApiTimeout(query, 'posts.fetchPosts', 8000);

  // ----------------------------------------------------------------
  // embed fallback: post_communities embed が PostgREST schema cache 上で
  // 解決できなかった場合 (古い Supabase / 権限不足) は POSTS_SELECT_COLS 単独で
  // 再 fetch して、後段の attachOfficialAuthor を別 RTT で呼ぶ。
  // ----------------------------------------------------------------
  let usedEmbedFallback = false;
  if (error && isEmbedFailure(error)) {
    console.warn(
      '[posts] post_communities embed failed — falling back to legacy 2-RTT path:',
      (error as { message?: string }).message,
    );
    // 同じクエリを embed 抜きで組み直す
    let fb = supabase
      .from('posts')
      .select(POSTS_SELECT_COLS)
      .eq('is_anonymous', true)
      .eq('is_public', true)
      .limit(effectiveLimit);
    if (home) fb = fb.in('visibility', ['public', 'community_public']);
    if (blockedTags.length > 0) {
      const SERVER_LIMIT = 80;
      const serverSide = blockedTags.length > SERVER_LIMIT
        ? blockedTags.slice(0, SERVER_LIMIT)
        : blockedTags;
      fb = fb.not('tag_names', 'cs', `{${serverSide.join(',')}}`);
    }
    if (filterTags && filterTags.length > 0) {
      fb = fb.overlaps('tag_names', filterTags);
    }
    if (effectiveSort === 'new') {
      fb = fb.order('created_at', { ascending: false }).order('id', { ascending: false });
      if (cursor) {
        const parsedComposite = parseNewCompositeCursor(cursor);
        if (parsedComposite) {
          fb = fb.or(
            `created_at.lt.${parsedComposite.ts},and(created_at.eq.${parsedComposite.ts},id.lt.${parsedComposite.id})`,
          );
        } else {
          const v = parseTimestampCursor(cursor);
          if (v) fb = fb.lt('created_at', v);
        }
      }
    } else if (effectiveSort === 'top') {
      fb = fb.order('likes_count', { ascending: false }).order('created_at', { ascending: false });
      if (cursor) {
        const p = parseCompositeCursor(cursor);
        if (p) {
          fb = fb.or(`likes_count.lt.${p.likes},and(likes_count.eq.${p.likes},created_at.lt.${p.ts})`);
        }
      }
    } else {
      fb = fb.order('hot_score', { ascending: false }).order('created_at', { ascending: false });
      if (cursor) {
        const p = parseHotCursor(cursor);
        if (p) {
          fb = fb.or(`hot_score.lt.${p.hot},and(hot_score.eq.${p.hot},created_at.lt.${p.ts})`);
        }
      }
    }
    const r = await withApiTimeout(fb, 'posts.fetchPosts.embedFallback', 8000);
    // legacy SELECT 結果を embed 型に注入する (post_communities 列が無いだけで
    // 後段の usedEmbedFallback 分岐で素通しされるので安全)
    data = r.data as unknown as typeof data;
    error = r.error;
    usedEmbedFallback = true;
  }

  // ----------------------------------------------------------------
  // hot fallback: hot_score column が無い環境 (PG: 42703 undefined_column)
  // の場合、旧 likes_count desc に戻して再 fetch する。
  // PostgREST は code='42703' を返してくる (Supabase JS で error.code が
  // 露出する)。message でも "hot_score" を含むので二重チェック。
  // ----------------------------------------------------------------
  let usedHotFallback = false;
  if (isHot && error) {
    const code = (error as { code?: string }).code ?? '';
    const msg = (error as { message?: string }).message ?? '';
    const isMissingColumn =
      code === '42703' ||
      /hot_score/i.test(msg) ||
      /does not exist/i.test(msg);
    if (isMissingColumn) {
      // 旧 query を組み直して再実行 (likes_count desc, created_at desc)
      // embed が動く環境なら fallback でも embed 経路を維持する。
      // PostgREST の TS 型は SELECT 文字列をリテラルで型解析するため、
      // 共通フィルタの適用には any 経由で型再帰を回避する (結果は unknown cast で揃える)。
      const baseFb = usedEmbedFallback
        ? supabase.from('posts').select(POSTS_SELECT_COLS)
        : supabase.from('posts').select(POSTS_SELECT_COLS_WITH_COMM);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = baseFb;
      q = q.eq('is_anonymous', true).eq('is_public', true).limit(effectiveLimit);
      if (home) q = q.in('visibility', ['public', 'community_public']);
      if (blockedTags.length > 0) {
        const SERVER_LIMIT = 80;
        const serverSide = blockedTags.length > SERVER_LIMIT
          ? blockedTags.slice(0, SERVER_LIMIT)
          : blockedTags;
        q = q.not('tag_names', 'cs', `{${serverSide.join(',')}}`);
      }
      if (filterTags && filterTags.length > 0) {
        q = q.overlaps('tag_names', filterTags);
      }
      q = q
        .order('likes_count', { ascending: false })
        .order('created_at', { ascending: false });
      if (cursor) {
        const parsed = parseCompositeCursor(cursor);
        if (parsed) {
          q = q.or(
            `likes_count.lt.${parsed.likes},and(likes_count.eq.${parsed.likes},created_at.lt.${parsed.ts})`,
          );
        }
      }
      const fbResult = await withApiTimeout<{ data: unknown; error: unknown }>(
        q,
        'posts.fetchPosts.hotFallback',
        8000,
      );
      data = fbResult.data as unknown as typeof data;
      error = fbResult.error as typeof error;
      usedHotFallback = true;
      if (!error) {
        console.warn('[posts] hot_score column missing — using legacy likes_count fallback');
      }
    }
  }

  if (error) throw error;

  // embed 経路 → 純粋関数で official_author を attach (RTT ゼロ)
  // legacy 経路 (embed 失敗) → 別 RTT で attachOfficialAuthor を呼ぶ
  const rawPosts = (data ?? []) as PostWithEmbeddedComm[];
  const posts = usedEmbedFallback
    ? (rawPosts as Post[])
    : attachOfficialAuthorFromEmbed<Post>(rawPosts);
  let nextCursor: string | null = null;
  // rising モードは client side 再ランクで上位 30 件しか出さないため、
  // ページングしても意味がない (= 31 件目以下を server 側で fetch しても
  // 速度上位は前ページに既に含まれている)。常に nextCursor=null で打ち切る。
  if (!isRising && posts.length === effectiveLimit) {
    const last = posts[posts.length - 1];
    if (last) {
      if (effectiveSort === 'new') {
        // composite cursor: created_at + id で tie-break (Audit D #6)
        nextCursor = `${last.created_at}|${last.id}`;
      } else if (isHot && !usedHotFallback) {
        // hot 通常経路: hot_score|created_at の合成 cursor
        const hotVal = (last as { hot_score?: number | null }).hot_score;
        const hotStr = typeof hotVal === 'number' && Number.isFinite(hotVal) ? String(hotVal) : '0';
        nextCursor = `${hotStr}|${last.created_at}`;
      } else {
        // top / hot fallback: likes_count|created_at
        nextCursor = `${last.likes_count}|${last.created_at}`;
      }
    }
  }
  // embed 経路で attach 済 → 2nd RTT を skip。
  // legacy 経路 (embed 失敗時) のみ attachOfficialAuthor を呼ぶ。
  const decorated = usedEmbedFallback ? await attachOfficialAuthor(posts) : posts;
  return { posts: decorated, nextCursor };
}

import { sanitizeContent, sanitizeTag, sanitizeUrl } from '../sanitize';
import { checkRate, rateLimitMessage } from '../rateLimit';

// ============================================================
// Discover — 検索タブの Instagram 風グリッド用
// ------------------------------------------------------------
// media_urls.length > 0 な公開投稿だけを新着順で取得。
// 「写真ベースで偶然の出会いを増やす」UX のための最小 API。
// (将来は trending / personalize で並び替えに切り替え予定)
// ============================================================
export type DiscoverMediaPost = {
  id: string;
  content: string;
  media_urls: string[];
  media_blurhashes: string[] | null;
  likes_count: number;
  comments_count: number;
  created_at: string;
};

export async function fetchDiscoverMediaPosts(opts: {
  limit?: number;
  /** ISO 文字列。これより古い created_at で絞る (無限スクロール) */
  beforeCreatedAt?: string;
} = {}): Promise<DiscoverMediaPost[]> {
  const limit = Math.max(6, Math.min(opts.limit ?? 36, 60));
  // not-empty array filter: Supabase で `media_urls != '{}'` は使えないので
  // PostgREST の cs (contains) を使う代替で「1 件以上」を表現できないため、
  // overfetch + client filter で対応。
  // 監査指摘: text[] の長さフィルタは PostgREST に無いので client 側で削るしかない。
  let query = supabase
    .from('posts')
    .select('id, content, media_urls, media_blurhashes, likes_count, comments_count, created_at')
    .eq('is_anonymous', true)
    .eq('is_public', true)
    .order('created_at', { ascending: false })
    .limit(limit * 3); // overfetch して空 media を捨ててから limit 件返す

  if (opts.beforeCreatedAt) {
    query = query.lt('created_at', opts.beforeCreatedAt);
  }

  const { data, error } = await withApiTimeout(query, 'posts.fetchDiscoverMediaPosts', 8000);
  if (error) {
    console.warn('[posts] fetchDiscoverMediaPosts failed:', error.message);
    return [];
  }
  const rows = (data ?? []) as DiscoverMediaPost[];
  // 写真があるものだけ + limit
  return rows
    .filter((p) => Array.isArray(p.media_urls) && p.media_urls.length > 0)
    .slice(0, limit);
}

export async function createPost({
  content,
  title = null,
  mediaUris,
  videoUris = [],
  videoDurations = [],
  videoPosters = [],
  tagNames,
  isAnonymous,
  kind = 'opinion',
  sourceUrl,
  isPublic = true,
  contentWarning = null,
  cwCategory = null,
  poll,
  visibility = 'public',
  community_ids = [],
}: {
  content: string;
  /** ★ BBS 統合 (migration 0075): スレ形式 post の title。 null なら通常の写真投稿。 */
  title?: string | null;
  /**
   * 画像の公開 URL 配列。**必ず** lib/media.ts の uploadPostImage で Storage に
   * upload した後の URL を渡すこと。ローカル URI (file:// / blob:) を直接渡すと
   * 他デバイスから見られない silent bug になる。
   */
  mediaUris: string[];
  /** 動画の公開 URL 配列。uploadPostVideo の戻り値を渡す。 */
  videoUris?: string[];
  /** videoUris と同じ index で対応する秒数。取得できなければ 0。 */
  videoDurations?: number[];
  /** videoUris と同じ index で対応するポスター画像 URL (任意)。 */
  videoPosters?: string[];
  tagNames: string[];
  isAnonymous: boolean;
  kind?: 'fact' | 'opinion' | 'joke' | 'wip';
  sourceUrl?: string | null;
  isPublic?: boolean;
  contentWarning?: string | null;
  cwCategory?: 'spoiler' | 'nsfw' | 'violence' | 'sensitive' | null;
  poll?: { question: string; options: string[]; multiSelect?: boolean; expiresInHours?: number };
  // 4-way visibility (default 'public' — 既存挙動)
  visibility?: PostVisibility;
  // visibility が community_only / community_public の時に attach する community 一覧
  community_ids?: string[];
}): Promise<void> {
  // Rate limit (client-side, defense-in-depth)
  const rl = checkRate('post');
  if (!rl.ok) throw new Error(rateLimitMessage('post', rl.retryAfterMs));

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Sanitize 入力
  const safeContent = sanitizeContent(content, { maxLength: 2000 });
  const safeTags = tagNames.map(sanitizeTag).filter(Boolean);
  const safeSourceUrl = sourceUrl ? sanitizeUrl(sourceUrl) : null;
  const safeContentWarning = contentWarning ? sanitizeContent(contentWarning, { maxLength: 200 }) : null;

  // ★ 重要 sanity check: ローカル URI が混ざっていたら投稿前に弾く。
  // これがないと「投稿者本人だけ画像が見える」silent bug が再発する。
  // 呼出側 (app/post/create.tsx) で uploadPostImage / uploadPostVideo を必ず
  // 通してから createPost を叩く契約。
  for (const u of mediaUris) {
    if (u && !/^https?:\/\//i.test(u)) {
      throw new Error('画像が Storage にアップロードされていません。再度お試しください。');
    }
  }
  for (const u of videoUris) {
    if (u && !/^https?:\/\//i.test(u)) {
      throw new Error('動画が Storage にアップロードされていません。再度お試しください。');
    }
  }

  // title は 80 字 cap + trim、 空文字なら null
  const safeTitle = title ? (sanitizeContent(title, { maxLength: 80 }).trim() || null) : null;

  const { data: post, error } = await supabase.from('posts').insert({
    content: safeContent,
    title: safeTitle,
    media_urls: mediaUris,
    media_blurhashes: [],
    video_urls: videoUris,
    video_durations: videoDurations,
    video_posters: videoPosters,
    tag_names: safeTags,
    is_anonymous: isAnonymous,
    author_id: user.id,
    kind,
    source_url: safeSourceUrl,
    is_public: isPublic,
    content_warning: safeContentWarning,
    cw_category: cwCategory,
    visibility,
  }).select('id').single();
  if (error) throw error;

  const postId = (post as { id: string }).id;

  // community attach (post insert 成功後 — RLS が author を見るため順序が重要)
  // 重複排除 + 空文字弾き
  if (
    community_ids.length > 0 &&
    (visibility === 'community_only' || visibility === 'community_public')
  ) {
    const uniqueIds = Array.from(new Set(community_ids.filter((c) => c && c.length > 0)));
    if (uniqueIds.length > 0) {
      const rows = uniqueIds.map((community_id) => ({ post_id: postId, community_id }));
      const { error: attachErr } = await supabase.from('post_communities').insert(rows);
      if (attachErr) {
        // 致命的ではない (post 自体は成功) — ログだけ残してユーザーには知らせる
        console.warn('[createPost] community attach failed:', attachErr.message);
        throw new Error('コミュニティへの紐付けに失敗しました');
      }
    }
  }

  // Poll を作成
  if (poll && poll.options.filter((o) => o.trim()).length >= 2) {
    const expiresAt = poll.expiresInHours
      ? new Date(Date.now() + poll.expiresInHours * 3600 * 1000).toISOString()
      : null;
    const { data: pollRow, error: pollErr } = await supabase.from('polls').insert({
      post_id: postId,
      question: poll.question.trim(),
      expires_at: expiresAt,
      multi_select: !!poll.multiSelect,
    }).select('id').single();
    if (pollErr) throw pollErr;
    const opts = poll.options
      .map((label, i) => ({ poll_id: (pollRow as { id: string }).id, label: label.trim(), ordinal: i }))
      .filter((o) => o.label.length > 0);
    if (opts.length > 0) {
      await supabase.from('poll_options').insert(opts);
    }
  }
}

// ============================================================
// 指定コミュニティの posts (visibility=community_only/community_public で attach されているもの)
// post_communities → posts の join + cursor pagination
// ============================================================
export async function fetchCommunityPosts({
  community_id,
  sort = 'new',
  cursor,
  limit = 30,
}: {
  community_id: string;
  sort?: SortMode;
  cursor?: string;
  limit?: number;
}): Promise<{ posts: Post[]; nextCursor: string | null }> {
  if (!community_id || !UUID_RE.test(community_id)) {
    return { posts: [], nextCursor: null };
  }

  // post_communities から post_id 一覧を取得 (新しい attach 順)
  // limit は 1 ページ分 — sort=hot/top の場合は post 側で並び替えるので余分に取らない
  let pcQuery = supabase
    .from('post_communities')
    .select('post_id, created_at')
    .eq('community_id', community_id)
    .order('created_at', { ascending: false })
    .limit(limit);

  // cursor (new sort 時のみ意味あり — attach 時刻)
  const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
  if (sort === 'new' && cursor && ISO_RE.test(cursor)) {
    pcQuery = pcQuery.lt('created_at', cursor);
  }

  const { data: pcRows, error: pcErr } = await withApiTimeout(
    pcQuery,
    'posts.fetchCommunityPosts.junction',
    8000,
  );
  if (pcErr) {
    console.warn('[fetchCommunityPosts] junction fetch failed:', pcErr.message);
    return { posts: [], nextCursor: null };
  }
  const rows = (pcRows ?? []) as { post_id: string; created_at: string }[];
  if (rows.length === 0) return { posts: [], nextCursor: null };

  const postIds = rows.map((r) => r.post_id);
  // post_communities embed を含む SELECT で 1 RTT 化。失敗時は legacy 2-RTT に fallback。
  let postsQuery = supabase
    .from('posts')
    .select(POSTS_SELECT_COLS_WITH_COMM)
    .in('id', postIds);

  if (sort === 'top') {
    postsQuery = postsQuery
      .order('likes_count', { ascending: false })
      .order('created_at', { ascending: false });
  } else if (sort === 'hot') {
    postsQuery = postsQuery
      .order('likes_count', { ascending: false })
      .order('created_at', { ascending: false });
  } else {
    // new / for-you / rising — いずれもクライアント側で再ランクされる前提で時系列を渡す。
    // (for-you=パーソナライズ、rising=likes/分 速度。詳細は SortMode コメント参照)
    postsQuery = postsQuery.order('created_at', { ascending: false });
  }

  let { data, error } = await withApiTimeout(postsQuery, 'posts.fetchCommunityPosts', 8000);
  let usedFallback = false;
  if (error && isEmbedFailure(error)) {
    console.warn(
      '[fetchCommunityPosts] embed failed — fallback to legacy path:',
      (error as { message?: string }).message,
    );
    let fb = supabase.from('posts').select(POSTS_SELECT_COLS).in('id', postIds);
    if (sort === 'top' || sort === 'hot') {
      fb = fb.order('likes_count', { ascending: false }).order('created_at', { ascending: false });
    } else {
      fb = fb.order('created_at', { ascending: false });
    }
    const r = await withApiTimeout(fb, 'posts.fetchCommunityPosts.embedFallback', 8000);
    // legacy SELECT 結果を embed 型に注入する (後段 usedFallback=true で素通し)
    data = r.data as unknown as typeof data;
    error = r.error;
    usedFallback = true;
  }
  if (error) {
    console.warn('[fetchCommunityPosts] posts fetch failed:', error.message);
    return { posts: [], nextCursor: null };
  }
  const rawPosts = (data ?? []) as PostWithEmbeddedComm[];
  const posts: Post[] = usedFallback
    ? (rawPosts as Post[])
    : attachOfficialAuthorFromEmbed<Post>(rawPosts);

  // nextCursor: new sort 時のみ attach 時刻ベースで返す
  let nextCursor: string | null = null;
  if (sort === 'new' && rows.length === limit) {
    const last = rows[rows.length - 1];
    if (last) nextCursor = last.created_at;
  }

  // embed 経路で attach 済 → 2nd RTT を skip。
  const decorated = usedFallback ? await attachOfficialAuthor(posts) : posts;

  // コミュニティタブ用: author の nickname + avatar_url を profiles から一括取得して attach。
  // is_anonymous フラグに関わらず全投稿に付与する (Reddit スタイル表示)。
  const authorIds = Array.from(
    new Set(decorated.map((p) => p.author_id).filter((id): id is string => Boolean(id))),
  );
  if (authorIds.length > 0) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, nickname, avatar_url')
      .in('id', authorIds);
    const profMap = new Map(
      (profs ?? []).map((p) => [p.id, p as { id: string; nickname: string; avatar_url: string | null }]),
    );
    return {
      posts: decorated.map((p) => {
        const prof = p.author_id ? profMap.get(p.author_id) : undefined;
        if (!prof) return p;
        return { ...p, author_nickname: prof.nickname, author_avatar_url: prof.avatar_url };
      }),
      nextCursor,
    };
  }

  return { posts: decorated, nextCursor };
}

export async function fetchPostById(id: string): Promise<Post | null> {
  if (!id || !UUID_RE.test(id)) return null;
  // 1 RTT で post + 公式コミュ管理者情報を取得 (post_communities embed)。
  // embed 失敗時は legacy 2-RTT に fallback。
  const { data, error } = await withApiTimeout(
    supabase
      .from('posts')
      .select(POSTS_SELECT_COLS_WITH_COMM)
      .eq('id', id)
      .maybeSingle(),
    'posts.fetchPostById',
    8000,
  );
  if (error && isEmbedFailure(error)) {
    console.warn(
      '[fetchPostById] embed failed — fallback to legacy:',
      (error as { message?: string }).message,
    );
    const fb = await withApiTimeout(
      supabase
        .from('posts')
        .select(POSTS_SELECT_COLS)
        .eq('id', id)
        .maybeSingle(),
      'posts.fetchPostById.fallback',
      8000,
    );
    if (fb.error) {
      console.warn('[fetchPostById] error:', fb.error.message);
      return null;
    }
    if (!fb.data) return null;
    const [decoratedFb] = await attachOfficialAuthor([fb.data as Post]);
    return decoratedFb ?? null;
  }
  if (error) {
    // RLS で読めない場合や fetch エラー — 致命的ではないので null を返す
    console.warn('[fetchPostById] error:', error.message);
    return null;
  }
  if (!data) return null;
  const [decorated] = attachOfficialAuthorFromEmbed<Post>([data as PostWithEmbeddedComm]);
  return decorated ?? null;
}

// ============================================================
// 公式コミュ管理者投稿の de-anonymize
// ------------------------------------------------------------
// posts.author_id === communities.official_admin_user_id かつ
// is_official=true の community に紐付いている post には、実名 + 所属
// を派生フィールド official_author としてセットする。
// post → post_communities → communities を 1 リクエストで集約。
// 該当しない post は official_author = undefined のまま (anon 表示)。
// ============================================================
async function attachOfficialAuthor<T extends Post>(posts: T[]): Promise<T[]> {
  if (posts.length === 0) return posts;
  const postIds = posts.map((p) => p.id);
  const { data, error } = await withApiTimeout(
    supabase
      .from('post_communities')
      .select(
        'post_id, community:communities(is_official, official_admin_user_id, official_admin_display_name, official_organization)',
      )
      .in('post_id', postIds),
    'posts.attachOfficialAuthor',
    8000,
  );
  if (error) {
    // 致命的ではない — 公式表示が出ないだけで anon 表示にフォールバック
    console.warn('[attachOfficialAuthor] join failed:', error.message);
    return posts;
  }
  type CommunityCol = {
    is_official?: boolean | null;
    official_admin_user_id?: string | null;
    official_admin_display_name?: string | null;
    official_organization?: string | null;
  };
  type Row = { post_id: string; community: CommunityCol | CommunityCol[] | null };
  const rows = (data ?? []) as unknown as Row[];
  // post_id → official admin info (最初に該当する公式コミュ管理者を採用)
  const officialByPostId: Record<string, { name: string; organization: string }> = {};
  for (const r of rows) {
    if (!r.community) continue;
    const c = Array.isArray(r.community) ? r.community[0] : r.community;
    if (!c || !c.is_official || !c.official_admin_user_id) continue;
    const post = posts.find((p) => p.id === r.post_id);
    if (!post || !post.author_id) continue;
    if (post.author_id !== c.official_admin_user_id) continue;
    officialByPostId[r.post_id] = {
      name: c.official_admin_display_name ?? '',
      organization: c.official_organization ?? '',
    };
  }
  return posts.map((p) => {
    const off = officialByPostId[p.id];
    if (!off) return p;
    return { ...p, official_author: off };
  });
}

// ============================================================
// 各 post に紐付いた community のメタ情報をまとめて取得
// post_communities junction → communities テーブルを 1 リクエストで join
// FlashList 上に大量 post があっても N+1 にならないよう .in() で集約。
// ============================================================
export type PostCommunityRef = {
  community_id: string;
  name: string;
  icon_emoji: string;
  icon_url: string | null;
  is_official?: boolean;
};

// post id 配列 → 各 post に紐付いた community のメタ情報を返す
// 1 リクエストで集約 (FlashList 上の大量 post でも軽い)
export async function fetchCommunitiesForPosts(
  postIds: string[],
): Promise<Record<string, PostCommunityRef[]>> {
  if (postIds.length === 0) return {};
  const { data, error } = await withApiTimeout(
    supabase
      .from('post_communities')
      .select('post_id, community:communities(id, name, icon_emoji, icon_url, is_official)')
      .in('post_id', postIds),
    'posts.fetchCommunitiesForPosts',
    8000,
  );
  if (error) {
    console.warn('[fetchCommunitiesForPosts] error:', error.message);
    return {};
  }
  // Supabase の typed return は join 関係を array で返す形 (FK の方向に依らず) なので
  // 単一でも複数でも安全に扱えるよう unknown 経由で narrow。
  // community が null (RLS で読めない / 削除済み) の行は無視。
  type CommunityCol = { id: string; name: string; icon_emoji: string; icon_url: string | null; is_official?: boolean };
  type Row = {
    post_id: string;
    community: CommunityCol | CommunityCol[] | null;
  };
  const rows = (data ?? []) as unknown as Row[];
  const grouped: Record<string, PostCommunityRef[]> = {};
  for (const r of rows) {
    if (!r.community) continue;
    const community = Array.isArray(r.community) ? r.community[0] : r.community;
    if (!community) continue;
    const arr = grouped[r.post_id] ?? [];
    arr.push({
      community_id: community.id,
      name: community.name,
      icon_emoji: community.icon_emoji,
      icon_url: community.icon_url,
      is_official: community.is_official ?? false,
    });
    grouped[r.post_id] = arr;
  }
  return grouped;
}

// ============================================================
// Q&A モード (migration 0067) — post の author が enable/disable
// ------------------------------------------------------------
// - 認証必須 (Not authenticated → throw)
// - post.author_id === auth.uid() のチェックは server 側 RLS でも掛かるが、
//   silent failure を避けるため client でも 1 行 fetch して比較する。
// - 並び替えは server で再計算せず client side (lib/utils/qaSort.ts) に置く
//   → 既存 comments fetch / publication / cache key を一切いじらない契約。
// ============================================================
export async function togglePostQAMode(
  postId: string,
  enabled: boolean,
): Promise<void> {
  if (!postId || !UUID_RE.test(postId)) throw new Error('Invalid post id');

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // author check — RLS でも弾かれるが、UI で明示 error を出すために事前 fetch
  const { data: row, error: readErr } = await supabase
    .from('posts')
    .select('author_id')
    .eq('id', postId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!row) throw new Error('Post not found');
  const ownerId = (row as { author_id?: string | null }).author_id;
  if (!ownerId || ownerId !== user.id) {
    throw new Error('Q&A モードは投稿者のみが切替可能です');
  }

  const { error } = await supabase
    .from('posts')
    .update({ qa_mode: enabled })
    .eq('id', postId);
  if (error) throw error;
}
