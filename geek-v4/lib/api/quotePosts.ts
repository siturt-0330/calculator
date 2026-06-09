// ============================================================
// lib/api/quotePosts.ts — 引用投稿 (quote post) API
// ------------------------------------------------------------
// posts テーブルの quote_post_id 列 (migration 0142) を使って
// 引用投稿のプレビュー取得と引用投稿の作成を行う。
// ============================================================
import { supabase } from '../supabase';
import { withApiTimeout } from '../withApiTimeout';
import { swallow } from '../swallow';

// ============================================================
// 型定義
// ============================================================

/** 引用先投稿のプレビューデータ */
export type QuotedPostPreview = {
  id: string;
  content: string | null;
  title: string | null;
  tag_names: string[];
  created_at: string;
};

// ============================================================
// fetchQuotedPost — 引用先投稿のプレビューを取得
// ============================================================
// FlashList はセルをリサイクルするため、同じ postId のローダが
// unmount → remount するたびにネットワークリクエストが再発する。
// モジュールレベルの cache + in-flight dedup でセッション内の
// 重複フェッチを完全に排除する。
const _quoteCache = new Map<string, QuotedPostPreview | null>();
const _quoteInflight = new Map<string, Promise<QuotedPostPreview | null>>();

/**
 * 指定した投稿 ID のプレビューデータを取得する。
 * 削除済み / 存在しない場合は null を返す。
 * セッション内で同一 postId の結果はキャッシュされる。
 */
export async function fetchQuotedPost(postId: string): Promise<QuotedPostPreview | null> {
  // キャッシュヒット
  if (_quoteCache.has(postId)) {
    return _quoteCache.get(postId) ?? null;
  }

  // in-flight dedup — 同じ postId の fetch が進行中なら同じ Promise を返す
  const inflight = _quoteInflight.get(postId);
  if (inflight) return inflight;

  const promise = (async () => {
    try {
      const { data, error } = await withApiTimeout(
        supabase
          .from('posts')
          .select('id,content,title,tag_names,created_at')
          .eq('id', postId)
          .single(),
        'quotePosts.fetchQuotedPost',
        8000,
      );

      const result: QuotedPostPreview | null =
        error || !data
          ? null
          : {
              id: data.id as string,
              content: (data.content as string | null) ?? null,
              title: (data.title as string | null) ?? null,
              tag_names: Array.isArray(data.tag_names) ? (data.tag_names as string[]) : [],
              created_at: data.created_at as string,
            };

      _quoteCache.set(postId, result);
      return result;
    } catch (e) {
      swallow('quotePosts.fetchQuotedPost', e);
      return null;
    } finally {
      _quoteInflight.delete(postId);
    }
  })();

  _quoteInflight.set(postId, promise);
  return promise;
}

// ============================================================
// createQuotePost — 引用投稿を作成
// ============================================================

/** 引用投稿作成のオプション */
export type CreateQuotePostOpts = {
  content: string;
  quotePostId: string;
  tagNames?: string[];
  isAnonymous?: boolean;
};

/**
 * quote_post_id を持つ新しい投稿を作成する。
 * 成功時は `{ id }` を返し、失敗時は null を返す。
 * 副作用あり mutation のためリトライしない。
 */
export async function createQuotePost(
  opts: CreateQuotePostOpts,
): Promise<{ id: string } | null> {
  const { content, quotePostId, tagNames = [], isAnonymous = false } = opts;

  try {
    const { data, error } = await withApiTimeout(
      supabase
        .from('posts')
        .insert({
          content,
          quote_post_id: quotePostId,
          tag_names: tagNames,
          is_anonymous: isAnonymous,
        })
        .select('id')
        .single(),
      'quotePosts.createQuotePost',
      8000,
    );

    if (error || !data) {
      return null;
    }

    return { id: data.id as string };
  } catch (e) {
    swallow('quotePosts.createQuotePost', e);
    return null;
  }
}
