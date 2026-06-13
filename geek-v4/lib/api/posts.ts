import { supabase } from '../supabase';
import { withApiTimeout } from '../withApiTimeout';
import { sanitizeContent, sanitizeTag, sanitizeUrl } from '../sanitize';
import { checkRate, rateLimitMessage } from '../rateLimit';
import { swallow } from '../swallow';
import type { Post, PostVisibility } from '../../types/models';

export type { PostVisibility } from '../../types/models';

// ============================================================
// モジュールレベル定数
// ============================================================
/** デフォルトのAPIタイムアウト (ms) */
const POSTS_TIMEOUT_MS = 8000;
/** 1ページあたりのデフォルト取得件数 */
const POSTS_PAGE_SIZE = 20;
/** コミュニティフィードの1ページ取得件数 */
const COMMUNITY_PAGE_SIZE = 30;
/** rising モード: client 再ランク前に取得するバッファ件数 */
const RISING_FETCH_LIMIT = 100;
/** blockedTags をサーバー側フィルタに渡す上限 (URL 長さ制限対策) */
const BLOCKED_TAGS_SERVER_LIMIT = 80;
/** INT4 最大値 (likes_count cursor 検証用) */
const INT4_MAX = 2147483647;

// ============================================================
// モジュールレベル正規表現 (関数内で重複宣言しない)
// ============================================================
/** ISO 8601 タイムスタンプ検証 */
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
/** UUID v4 形式検証 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================================
// cursor パーサ — モジュールスコープに置いて重複を排除
// ============================================================

/**
 * new ソート用 cursor: ISO タイムスタンプ単体 (後方互換)
 * 不正な場合は null を返す (DoS 防止 — throw だと無限リロードが起きる)
 */
function parseTimestampCursor(c: string): string | null {
  return ISO_RE.test(c) ? c : null;
}

/**
 * new ソート用 composite cursor: `<ISO timestamp>|<uuid>`
 * 同一 created_at の境界で post が重複/欠落しないよう id で tie-break する (Audit D #6)。
 */
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

/**
 * top ソート用 composite cursor: `<likes_count>|<ISO timestamp>`
 * likes_count は INT4 範囲の正整数のみ許可。
 */
function parseCompositeCursor(c: string): { likes: number; ts: string } | null {
  const parts = c.split('|');
  if (parts.length !== 2) return null;
  const likesStr = parts[0];
  const ts = parts[1];
  if (!likesStr || !ts) return null;
  if (!/^\d{1,10}$/.test(likesStr)) return null;
  const likes = Number(likesStr);
  if (!Number.isFinite(likes) || likes < 0 || likes > INT4_MAX) return null;
  if (!ISO_RE.test(ts)) return null;
  return { likes, ts };
}

/**
 * hot ソート用 cursor: `<hot_score>|<ISO timestamp>`
 * hot_score は double precision (負値あり) なので浮動小数記法を許可する。
 */
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

// 'rising' = Reddit 風 "急上昇" — 直近 3h 内で likes/min が高い post を上位に。
//   server 側は実質 'new' (created_at desc limit 100) で取得し、
//   client 側 (hooks/useFeed) で lib/utils/risingScore.ts により再ランクする。
//   RPC/DB スキーマ変更不要。詳細は risingScore.ts のヘッダコメント参照。
export type SortMode = 'for-you' | 'hot' | 'new' | 'top' | 'rising';

// posts SELECT で取得するカラム一覧 (一箇所でメンテ可能)
// ★ de-anon Phase2 (2b): anon/authenticated から SELECT(author_id) を REVOKE するため、
//   client の REST SELECT から author_id を外す。投稿者アイデンティティ (avatar / pseudonym /
//   official_author / is_own) はすべて feed/community/detail の RPC (get_home_feed /
//   get_feed_page / get_community_feed) が server 側でマスクして供給する。
//   REST 経路 (この SELECT) はカード本体 (本文 / media / counters 等) のみを担う。
const POSTS_SELECT_COLS =
  'id, content, title, last_activity_at, media_urls, media_blurhashes, video_urls, video_posters, tag_names, likes_count, comments_count, score, hot_score, concern_count, kind, source_url, is_public, trust_score_at_post, is_anonymous, content_warning, cw_category, visibility, qa_mode, created_at';
// ★ edited_at は POSTS_SELECT_COLS に入れない。0133(edited_at列追加)未適用の本番に
//   コードが先に出ると PostgREST が 42703(column does not exist)で全 post 取得を
//   落とすため(deploy-ordering 結合)。「編集済み」バッジが要る詳細画面だけ、下記
//   fetchPostEditedAt で edited_at を *耐性付き* に取りに行く(列欠落は null 扱い)。

// ★ de-anon Phase2 (2b): 公式管理者投稿の official_author は REST embed では
//   判定できなくなった (判定に必要な author_id を SELECT から外したため)。
//   feed / community / detail は useFeedPage / RPC (get_home_feed・get_feed_page・
//   get_community_feed) が official_author を server 側でマスク供給するので、
//   REST 側の embed 取得 + author_id マッチは廃止する。
//   後方互換のため別名は残すが中身は base SELECT と同一 (embed 無し)。
const POSTS_SELECT_COLS_WITH_COMM = POSTS_SELECT_COLS;

// (旧 embed 経路の名残) post_communities embed を含み得る生 post 型。
// 2b 以降 embed は撃たないが、後段の pass-through ヘルパ型を壊さないよう optional 保持。
type PostWithEmbeddedComm = Post & {
  post_communities?: unknown;
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
/**
 * 自分の投稿を削除する (author 本人のみ)。
 * RLS により本人以外の削除は 0 行 delete として扱われ、エラーとして明示される。
 * @throws 権限なし / 既に削除済みの場合
 */
export async function deleteOwnPost(postId: string): Promise<void> {
  const { data, error } = await withApiTimeout(
    supabase.from('posts').delete().eq('id', postId).select('id'),
    'posts.deleteOwn',
    POSTS_TIMEOUT_MS,
  );
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('削除できませんでした (権限が無いか、既に削除済みです)');
  }
}

// ★ de-anon Phase2 (2b): official_author は RPC (useFeedPage 等) が供給するため、
//   REST 経路では算出しない。embed フィールドが万一混ざっても Post 型に揃うよう
//   落とすだけの pass-through (author_id 非依存)。
function attachOfficialAuthorFromEmbed<T extends Post>(
  rawPosts: PostWithEmbeddedComm[],
): T[] {
  return rawPosts.map((p) => {
    // embed フィールド (post_communities) を返却 shape から落として Post 型に揃える
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { post_communities: _ignored, ...rest } = p;
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

/**
 * ホームフィード / タブ切替用の投稿一覧を cursor pagination で取得する。
 * - sort='for-you': 内部的に 'hot' と同じプールを 1.5x 件取得しクライアント側でパーソナライズ再ランク。
 * - sort='rising': 直近 100 件を新着順で取得し、クライアント側で likes/分 速度で再ランク。
 * - hot_score 列が未 apply の環境は自動的に likes_count フォールバックへ切替。
 */
export async function fetchPosts({
  sort = 'hot',
  blockedTags,
  cursor,
  limit = POSTS_PAGE_SIZE,
  filterTags,
  home = true,
}: FetchPostsOpts): Promise<{ posts: Post[]; nextCursor: string | null }> {
  const isForYou = sort === 'for-you';
  const isRising = sort === 'rising';
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
  const isHot = effectiveSort === 'hot';

  // ----------------------------------------------------------------
  // ベースクエリを構築するローカルヘルパ (cols 引数で embed あり/なしを切替)
  // PostgREST TS 型は SELECT 文字列リテラルをリテラルで解析するため、
  // 動的文字列を渡すと型推論が崩れる。unknown 経由で一度エスケープし、
  // フィルタ適用後に withApiTimeout へ渡す。
  // ----------------------------------------------------------------
  function buildBase(cols: string): unknown {
    // PostgREST の TS 型は SELECT 文字列リテラルを型パラメータとして解析するため、
    // 動的文字列を渡すと型推論が崩れる。ここでは any 経由で chaining し、
    // 最終的に unknown として返すことで型エラーを回避する。
    // (buildBase の戻り値は applySort / withApiTimeout で any として扱う)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = supabase
      .from('posts')
      .select(cols)
      .eq('is_anonymous', true)
      .eq('is_public', true)
      .limit(effectiveLimit);
    // ホームフィード: public / community_public のみ
    if (home) {
      q = q.in('visibility', ['public', 'community_public']);
    }
    // PostgREST の URL 長さ制限 (≒8KB) 対策: サーバー側は先頭 BLOCKED_TAGS_SERVER_LIMIT 個まで。
    if (blockedTags.length > 0) {
      const serverSide = blockedTags.length > BLOCKED_TAGS_SERVER_LIMIT
        ? blockedTags.slice(0, BLOCKED_TAGS_SERVER_LIMIT)
        : blockedTags;
      q = q.not('tag_names', 'cs', `{${serverSide.join(',')}}`);
    }
    if (filterTags && filterTags.length > 0) {
      q = q.overlaps('tag_names', filterTags);
    }
    return q;
  }

  // ----------------------------------------------------------------
  // ソート & cursor を適用するローカルヘルパ
  // ----------------------------------------------------------------
  function applySort(
    base: unknown,
    sortKey: 'hot' | 'new' | 'top',
    cur: string | undefined,
  ): unknown {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = base;
    if (sortKey === 'new') {
      q = q.order('created_at', { ascending: false }).order('id', { ascending: false });
      if (cur) {
        const parsedComposite = parseNewCompositeCursor(cur);
        if (parsedComposite) {
          q = q.or(
            `created_at.lt.${parsedComposite.ts},and(created_at.eq.${parsedComposite.ts},id.lt.${parsedComposite.id})`,
          );
        } else {
          // 旧形式 (ISO timestamp 単体) — 後方互換
          const validTs = parseTimestampCursor(cur);
          if (validTs) q = q.lt('created_at', validTs);
          // 不正 cursor は無視して先頭から (DoS 防止 — throw だと無限リロード)
        }
      }
    } else if (sortKey === 'top') {
      q = q.order('likes_count', { ascending: false }).order('created_at', { ascending: false });
      if (cur) {
        const parsed = parseCompositeCursor(cur);
        if (parsed) {
          q = q.or(`likes_count.lt.${parsed.likes},and(likes_count.eq.${parsed.likes},created_at.lt.${parsed.ts})`);
        }
      }
    } else {
      // hot: Reddit 風 hot_score。generated column 未 apply 環境では hot fallback へ。
      q = q.order('hot_score', { ascending: false }).order('created_at', { ascending: false });
      if (cur) {
        const parsed = parseHotCursor(cur);
        if (parsed) {
          q = q.or(
            `hot_score.lt.${parsed.hot},and(hot_score.eq.${parsed.hot},created_at.lt.${parsed.ts})`,
          );
        }
      }
    }
    return q;
  }

  // ----------------------------------------------------------------
  // プライマリクエリ実行
  // ----------------------------------------------------------------
  type QueryResult = { data: unknown; error: unknown };
  let { data, error } = await withApiTimeout<QueryResult>(
    applySort(buildBase(POSTS_SELECT_COLS_WITH_COMM), effectiveSort, cursor) as Promise<QueryResult>,
    'posts.fetchPosts',
    POSTS_TIMEOUT_MS,
  );

  // ----------------------------------------------------------------
  // embed fallback: post_communities embed が PostgREST schema cache 上で
  // 解決できなかった場合は POSTS_SELECT_COLS 単独で再 fetch する。
  // ----------------------------------------------------------------
  let usedEmbedFallback = false;
  if (error && isEmbedFailure(error)) {
    console.warn(
      '[posts] post_communities embed failed — falling back to legacy 2-RTT path:',
      (error as { message?: string }).message,
    );
    const r = await withApiTimeout<QueryResult>(
      applySort(buildBase(POSTS_SELECT_COLS), effectiveSort, cursor) as Promise<QueryResult>,
      'posts.fetchPosts.embedFallback',
      POSTS_TIMEOUT_MS,
    );
    data = r.data;
    error = r.error;
    usedEmbedFallback = true;
  }

  // ----------------------------------------------------------------
  // hot fallback: hot_score column が無い環境 (PG: 42703) では
  // likes_count desc にフォールバックする。
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
      const cols = usedEmbedFallback ? POSTS_SELECT_COLS : POSTS_SELECT_COLS_WITH_COMM;
      const fbResult = await withApiTimeout<QueryResult>(
        applySort(buildBase(cols), 'top', cursor) as Promise<QueryResult>,
        'posts.fetchPosts.hotFallback',
        POSTS_TIMEOUT_MS,
      );
      data = fbResult.data;
      error = fbResult.error;
      usedHotFallback = true;
      if (!error) {
        console.warn('[posts] hot_score column missing — using legacy likes_count fallback');
      }
    }
  }

  if (error) throw error;

  const rawPosts = (data ?? []) as PostWithEmbeddedComm[];
  const posts = usedEmbedFallback
    ? (rawPosts as Post[])
    : attachOfficialAuthorFromEmbed<Post>(rawPosts);

  // rising モードはクライアント側再ランクで上位 30 件しか出さないためページング不要。
  let nextCursor: string | null = null;
  if (!isRising && posts.length === effectiveLimit) {
    const last = posts[posts.length - 1];
    if (last) {
      if (effectiveSort === 'new') {
        nextCursor = `${last.created_at}|${last.id}`;
      } else if (isHot && !usedHotFallback) {
        const hotVal = (last as { hot_score?: number | null }).hot_score;
        const hotStr = typeof hotVal === 'number' && Number.isFinite(hotVal) ? String(hotVal) : '0';
        nextCursor = `${hotStr}|${last.created_at}`;
      } else {
        nextCursor = `${last.likes_count}|${last.created_at}`;
      }
    }
  }

  // embed 経路で attach 済 → 2nd RTT を skip。legacy 経路のみ attachOfficialAuthor を呼ぶ。
  const decorated = usedEmbedFallback ? await attachOfficialAuthor(posts) : posts;
  return { posts: decorated, nextCursor };
}

/**
 * 新規投稿を作成する。
 * - client-side レート制限 + 入力サニタイズを実施してから INSERT する。
 * - `onInserted` を渡すと INSERT 成功直後 (postId 確定後) に呼ばれ、呼出側が
 *   コミュニティ attach / poll の完了を待たずに画面遷移できる (v2 楽観的即遷移)。
 * - コミュニティ attach 失敗時は補償 DELETE で孤児 post を除去して throw する。
 * @throws レート超過 / 未認証 / ローカル URI 混入 / attach 失敗 / DB エラー
 */
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
  onInserted,
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
  /**
   * ★ v2 楽観的即遷移 (optional・後方互換):
   *   INSERT 成功直後 (postId 確定後・attach/poll の前) に同期で呼ばれる。
   *   呼出側はここで navigate + toast + reset し、attach/poll の往復を待たない。
   *   - 渡さなければ (他 2 画面) 従来どおり全 await。挙動は一切変わらない。
   *   - throw しないこと。ここで投げると attach/poll に到達せず post が孤児になる。
   *   - レート increment はこの関数冒頭の checkRate が 1 回だけ行う (onInserted は navigate のみ)。
   */
  onInserted?: (postId: string) => void;
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

  const { data: post, error } = await withApiTimeout(
    supabase.from('posts').insert({
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
    }).select('id').single(),
    'posts.createPost',
    POSTS_TIMEOUT_MS,
  );
  if (error) throw error;

  const postId = (post as { id: string }).id;

  // ★ v2 楽観的即遷移: INSERT 成功 = postId 確定。ここで呼出側に navigate を許す。
  //   attach (post_communities) / poll はこの後 await で続行する (=呼出側から見ると背後)。
  //   onInserted が throw すると attach/poll に到達できず孤児 post が残るため swallow でガード。
  if (onInserted) {
    try {
      onInserted(postId);
    } catch (e) {
      swallow('createPost.onInserted', e);
    }
  }

  // community attach (post insert 成功後 — RLS が author を見るため順序が重要)
  // 重複排除 + 空文字弾き
  if (
    community_ids.length > 0 &&
    (visibility === 'community_only' || visibility === 'community_public')
  ) {
    const uniqueIds = Array.from(new Set(community_ids.filter((c) => c && c.length > 0)));
    if (uniqueIds.length > 0) {
      const attachRows = uniqueIds.map((community_id) => ({ post_id: postId, community_id }));
      const { error: attachErr } = await withApiTimeout(
        supabase.from('post_communities').insert(attachRows),
        'posts.createPost.communityAttach',
        POSTS_TIMEOUT_MS,
      );
      if (attachErr) {
        console.warn('[createPost] community attach failed:', attachErr.message);
        // ★ 補償: コミュ紐付け失敗時は作りかけの post を削除して孤児を残さない
        //   (非会員のディープリンク投稿等で RLS が attach を拒否するケース)。
        const { error: deleteErr } = await withApiTimeout(
          supabase.from('posts').delete().eq('id', postId).select('id'),
          'posts.createPost.compensatingDelete',
          POSTS_TIMEOUT_MS,
        );
        if (deleteErr) {
          swallow('posts.createPost.orphanCleanup', deleteErr);
        }
        throw new Error('このコミュニティには投稿できませんでした(参加が必要かもしれません)');
      }
    }
  }

  // Poll を作成
  if (poll && poll.options.filter((o) => o.trim()).length >= 2) {
    const expiresAt = poll.expiresInHours
      ? new Date(Date.now() + poll.expiresInHours * 3600 * 1000).toISOString()
      : null;
    const { data: pollRow, error: pollErr } = await withApiTimeout(
      supabase.from('polls').insert({
        post_id: postId,
        question: poll.question.trim(),
        expires_at: expiresAt,
        multi_select: !!poll.multiSelect,
      }).select('id').single(),
      'posts.createPost.poll',
      POSTS_TIMEOUT_MS,
    );
    if (pollErr) throw pollErr;
    const pollOpts = poll.options
      .map((label, i) => ({ poll_id: (pollRow as { id: string }).id, label: label.trim(), ordinal: i }))
      .filter((o) => o.label.length > 0);
    if (pollOpts.length > 0) {
      await withApiTimeout(
        supabase.from('poll_options').insert(pollOpts),
        'posts.createPost.pollOptions',
        POSTS_TIMEOUT_MS,
      );
    }
  }
}

// ============================================================
// 指定コミュニティの posts (visibility=community_only/community_public で attach されているもの)
// post_communities → posts の join + cursor pagination
// ============================================================
/**
 * 指定コミュニティに属する投稿を cursor pagination で取得する。
 * post_communities junction テーブルを経由して 2 クエリで取得する (N+1 なし)。
 * @returns posts 配列と次ページ cursor (new ソート時のみ)
 */
export async function fetchCommunityPosts({
  community_id,
  sort = 'new',
  cursor,
  limit = COMMUNITY_PAGE_SIZE,
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
  let pcQuery = supabase
    .from('post_communities')
    .select('post_id, created_at')
    .eq('community_id', community_id)
    .order('created_at', { ascending: false })
    .limit(limit);

  // cursor (new sort 時のみ意味あり — attach 時刻ベース)。ISO_RE はモジュールスコープのものを使う。
  if (sort === 'new' && cursor && ISO_RE.test(cursor)) {
    pcQuery = pcQuery.lt('created_at', cursor);
  }

  const { data: pcRows, error: pcErr } = await withApiTimeout(
    pcQuery,
    'posts.fetchCommunityPosts.junction',
    POSTS_TIMEOUT_MS,
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

  let { data, error } = await withApiTimeout(postsQuery, 'posts.fetchCommunityPosts', POSTS_TIMEOUT_MS);
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
    const r = await withApiTimeout(fb, 'posts.fetchCommunityPosts.embedFallback', POSTS_TIMEOUT_MS);
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

  // ★ de-anon Phase2 (2b): 名前付き投稿 (is_anonymous=false) の nickname / avatar も
  //   author_id 依存の REST join では引かない。コミュニティタブの投稿者表示
  //   (author_nickname / avatar / pseudonym / official_author) は get_community_feed RPC
  //   (0112 / community 用 RPC) が server 側で供給する。
  //   ここでは「実名を要求するクエリ自体を作らない」ことで、SELECT(author_id) REVOKE 後も
  //   匿名作者の身元が漏れないことを担保する。
  return { posts: decorated, nextCursor };
}

/**
 * 単一投稿を ID で取得する。
 * embed 失敗時は POSTS_SELECT_COLS のみで再取得する (legacy fallback)。
 * RLS で読めない場合や存在しない場合は null を返す (throw しない)。
 */
export async function fetchPostById(id: string): Promise<Post | null> {
  if (!id || !UUID_RE.test(id)) return null;
  const { data, error } = await withApiTimeout(
    supabase
      .from('posts')
      .select(POSTS_SELECT_COLS_WITH_COMM)
      .eq('id', id)
      .maybeSingle(),
    'posts.fetchPostById',
    POSTS_TIMEOUT_MS,
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
      POSTS_TIMEOUT_MS,
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
// fetchPostEditedAt — 「編集済み」バッジ用に edited_at だけを耐性付きで取得
// ------------------------------------------------------------
// ★ 0133 (edited_at 列追加) が未適用の環境でも壊れないよう、列欠落 (42703) や
//   その他エラーは握り潰して null を返す = バッジが出ないだけで他機能に無影響。
//   これにより POSTS_SELECT_COLS に edited_at を入れずに済み、全 post 取得経路を
//   migration の適用順から切り離せる (deploy-ordering 結合の解消)。
// ============================================================
/**
 * 「編集済み」バッジ用に edited_at だけを耐性付きで取得する。
 * 0133 (edited_at 列追加) 未適用の環境でも壊れないよう、列欠落 / エラーは null を返す。
 * バッジが出ないだけで他機能に無影響 (deploy-ordering 結合の解消)。
 */
export async function fetchPostEditedAt(postId: string): Promise<string | null> {
  if (!postId || !UUID_RE.test(postId)) return null;
  try {
    const { data, error } = await withApiTimeout(
      supabase.from('posts').select('edited_at').eq('id', postId).maybeSingle(),
      'posts.fetchEditedAt',
      POSTS_TIMEOUT_MS,
    );
    if (error || !data) return null; // 列欠落(0133未適用)/RLS/通信失敗 → 「未編集」扱い
    return (data as { edited_at?: string | null }).edited_at ?? null;
  } catch (e) {
    swallow('posts.fetchPostEditedAt', e);
    return null;
  }
}

/**
 * 複数の投稿 ID をまとめて 1 RTT で取得する (検索結果 hydrate 用)。
 * 返り順は不定なので、呼出側でランキング順に並べ直すこと。
 * embed 失敗時は POSTS_SELECT_COLS のみで fallback する。
 */
export async function fetchPostsByIds(ids: string[]): Promise<Post[]> {
  const valid = ids.filter((id) => id && UUID_RE.test(id));
  if (valid.length === 0) return [];
  const { data, error } = await withApiTimeout(
    supabase.from('posts').select(POSTS_SELECT_COLS_WITH_COMM).in('id', valid),
    'posts.fetchPostsByIds',
    POSTS_TIMEOUT_MS,
  );
  if (error && isEmbedFailure(error)) {
    const fb = await withApiTimeout(
      supabase.from('posts').select(POSTS_SELECT_COLS).in('id', valid),
      'posts.fetchPostsByIds.fallback',
      POSTS_TIMEOUT_MS,
    );
    if (fb.error) {
      console.warn('[fetchPostsByIds] error:', fb.error.message);
      return [];
    }
    return attachOfficialAuthor((fb.data ?? []) as Post[]);
  }
  if (error) {
    console.warn('[fetchPostsByIds] error:', error.message);
    return [];
  }
  return attachOfficialAuthorFromEmbed<Post>((data ?? []) as PostWithEmbeddedComm[]);
}

// ============================================================
// 公式コミュ管理者投稿の de-anonymize (★ de-anon Phase2 で REST 算出は廃止)
// ------------------------------------------------------------
// 旧実装は posts.author_id === communities.official_admin_user_id を REST で
// 突合して official_author を派生していた。2b で SELECT(author_id) を REVOKE
// するため、この判定は server 側 RPC (get_home_feed / get_feed_page /
// get_community_feed = useFeedPage 経由) に一本化した。
// REST 経路 (fetchPosts/ById/ByIds/CommunityPosts) は official_author を算出
// しない pass-through に縮退する。embed 失敗 fallback からも呼ばれ続けるため、
// 呼び出し側を壊さないようシグネチャは維持 (no-op)。
// ============================================================
async function attachOfficialAuthor<T extends Post>(posts: T[]): Promise<T[]> {
  return posts;
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
  // fetchCommunitiesForPosts は供給する。feed RPC 等の他ソースは未供給(任意)。
  icon_color?: string;
  icon_url: string | null;
  is_official?: boolean;
};

/**
 * post id 配列に紐付いた community メタ情報を 1 リクエストで取得する。
 * FlashList 上の大量 post でも N+1 にならないよう .in() で集約する。
 * 非 UUID や存在しない post_id は無視される (PostgREST 22P02 防止)。
 */
export async function fetchCommunitiesForPosts(
  postIds: string[],
): Promise<Record<string, PostCommunityRef[]>> {
  const validIds = postIds.filter((id) => id && UUID_RE.test(id));
  if (validIds.length === 0) return {};
  const { data, error } = await withApiTimeout(
    supabase
      .from('post_communities')
      .select('post_id, community:communities(id, name, icon_emoji, icon_color, icon_url, is_official)')
      .in('post_id', validIds),
    'posts.fetchCommunitiesForPosts',
    POSTS_TIMEOUT_MS,
  );
  if (error) {
    console.warn('[fetchCommunitiesForPosts] error:', error.message);
    return {};
  }
  // Supabase の typed return は join 関係を array で返す形 (FK の方向に依らず) なので
  // 単一でも複数でも安全に扱えるよう unknown 経由で narrow。
  // community が null (RLS で読めない / 削除済み) の行は無視。
  type CommunityCol = { id: string; name: string; icon_emoji: string; icon_color: string; icon_url: string | null; is_official?: boolean };
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
      icon_color: community.icon_color,
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
// - ★ de-anon Phase2 (2b): author 判定を client の author_id 突合から外す。
//   RLS (posts_update = `auth.uid() = author_id`) が本人以外の UPDATE を弾くので、
//   `.select('id')` で実際に更新された行を確認し、0 行なら「権限なし」として明示
//   error を出す (deleteOwnPost と同じパターン)。これで SELECT(author_id) REVOKE 後も
//   silent success を避けつつ author_id を一切 SELECT しない。
// - 並び替えは server で再計算せず client side (lib/utils/qaSort.ts) に置く
//   → 既存 comments fetch / publication / cache key を一切いじらない契約。
// ============================================================
/**
 * Q&A モードの有効/無効を切り替える (author 本人のみ)。
 * RLS により本人以外の UPDATE は 0 行として扱われ、エラーとして明示される。
 * @throws 未認証 / 権限なし / 不正 post id
 */
export async function togglePostQAMode(
  postId: string,
  enabled: boolean,
): Promise<void> {
  if (!postId || !UUID_RE.test(postId)) throw new Error('Invalid post id');

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await withApiTimeout(
    supabase
      .from('posts')
      .update({ qa_mode: enabled })
      .eq('id', postId)
      .select('id'),
    'posts.toggleQAMode',
    POSTS_TIMEOUT_MS,
  );
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('Q&A モードは投稿者のみが切替可能です');
  }
}

// ============================================================
// updatePost — 自分の投稿を後から編集する (author 本人のみ)
// ------------------------------------------------------------
// - RLS posts_update = `auth.uid()=author_id` + with check(0133) が本人以外/
//   author_id 改竄を弾く。client は author_id を持たない/送らない。
// - `.select('id')` の 0 行で「権限なし or 不在」を明示 error 化 (togglePostQAMode 同型)。
// - edited_at は DB トリガ(0133)が content/media/video 実変化時のみスタンプ。手動不要。
// - 送るのは編集可能列のみ (content/title/tags/cw/media/video)。likes_count 等は
//   送らない (サーバ硬化 follow-up までの実用的封じ込め)。
// - media/video は「自分の Supabase posts-media バケットの https URL」のみ許可
//   (外部 URL / トラッキング pixel / 他バケットの差し込みを拒否 = bait-and-switch 対策)。
// - undefined のフィールドは触らない (部分更新)。
// ============================================================
const SB_URL_FOR_MEDIA = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '');

function assertOwnMediaUrl(u: string): void {
  if (!u) return;
  const ok =
    /^https:\/\//i.test(u) &&
    (SB_URL_FOR_MEDIA ? u.startsWith(SB_URL_FOR_MEDIA) : true) &&
    /\/posts-media\//.test(u);
  if (!ok) {
    throw new Error('メディアの URL が不正です (アップロード済みの画像/動画のみ編集できます)');
  }
}

/**
 * 自分の投稿を後から編集する (author 本人のみ)。
 * - 指定したフィールドのみ部分更新する (undefined は触らない)。
 * - RLS により本人以外の UPDATE は 0 行として扱われ、エラーとして明示される。
 * - media/video は自分の Supabase posts-media バケットの HTTPS URL のみ許可。
 * @throws 未認証 / 権限なし / 不正 URL / DB エラー
 */
export async function updatePost(
  postId: string,
  fields: {
    content?: string;
    title?: string | null;
    tagNames?: string[];
    contentWarning?: string | null;
    cwCategory?: string | null;
    mediaUrls?: string[];
    videoUrls?: string[];
    videoDurations?: number[];
    videoPosters?: string[];
  },
): Promise<void> {
  if (!postId || !UUID_RE.test(postId)) throw new Error('Invalid post id');

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // 送る列だけを組み立てる (undefined は触らない = 部分更新)。
  const patch: Record<string, unknown> = {};
  if (fields.content !== undefined) {
    patch.content = sanitizeContent(fields.content, { maxLength: 2000 });
  }
  if (fields.title !== undefined) {
    patch.title = fields.title
      ? sanitizeContent(fields.title, { maxLength: 80 }).trim() || null
      : null;
  }
  if (fields.tagNames !== undefined) {
    patch.tag_names = fields.tagNames.map(sanitizeTag).filter(Boolean);
  }
  if (fields.contentWarning !== undefined) {
    patch.content_warning = fields.contentWarning
      ? sanitizeContent(fields.contentWarning, { maxLength: 200 })
      : null;
  }
  if (fields.cwCategory !== undefined) patch.cw_category = fields.cwCategory;

  if (fields.mediaUrls !== undefined) {
    fields.mediaUrls.forEach(assertOwnMediaUrl);
    patch.media_urls = fields.mediaUrls;
    // media を差し替えたら blurhash の index 対応が崩れるのでリセット (createPost も [])。
    patch.media_blurhashes = [];
  }
  if (fields.videoUrls !== undefined) {
    fields.videoUrls.forEach(assertOwnMediaUrl);
    patch.video_urls = fields.videoUrls;
    patch.video_durations = fields.videoDurations ?? [];
    patch.video_posters = fields.videoPosters ?? [];
  }

  if (Object.keys(patch).length === 0) return; // 変更なし

  const { data, error } = await withApiTimeout(
    supabase.from('posts').update(patch).eq('id', postId).select('id'),
    'posts.update',
    POSTS_TIMEOUT_MS,
  );
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('編集できませんでした (権限が無いか、投稿が見つかりません)');
  }
}
