// ============================================================
// usePostDetail — 投稿詳細画面のデータ取得・派生状態をまとめたカスタム Hook
// ============================================================
// PostDetailScreen から以下を抽出:
//   - useQuery(['post', id])                  投稿本文
//   - useFeedPage([id])                       周辺データ (reactions / communities / ...)
//   - useQuery(['post-edited-at', id])         編集済みバッジ
//   - useQuery(['post-communities-of', id])    fallback コミュニティ (RPC 非対応時)
//   - useQuery(['similar-posts', ...])         類似投稿
//   - useQuery(['post-comments', id])          コメント
//   - Realtime useEffect                       コメント/投稿/リアクションの live 更新
//   - lastViewed useEffect                     既読管理
//   - 派生 memo (pseudo, officialAuthor, reactions, myMemes,
//                postCommunities, unreadIds, commentTree)
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { Image as RNImage, ScrollView } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchPostById,
  fetchCommunitiesForPosts,
  fetchPostEditedAt,
} from '../lib/api/posts';
import { fetchSimilarPosts } from '../lib/api/similarPosts';
import { fetchComments } from '../lib/api/comments';
import { attachChannel } from '../lib/realtime';
import { swallow } from '../lib/swallow';
import { useFeedPage } from './useFeedPage';
import { useReactionToggle } from './useReactions';
import { useCommentReactions, useCommentReactionToggle } from './useCommentReactions';
import { invalidateFeedPage } from '../lib/cacheUpdates/feedPagePatcher';
import { getLastViewed, setLastViewed } from '../lib/utils/lastViewed';
import { thumbedUrl } from '../lib/utils/imageUrl';
import { pseudonymFor } from '../lib/utils/pseudonym';
import { buildCommentTree } from '../lib/utils/commentTree';
import { getCachedAspect } from '../components/feed/AnonPostCard';
import type { Comment } from '../types/models';

/** imgAspects の lazy initial seed に使う既定アスペクト比 */
const DEFAULT_ASPECT = 4 / 3; // ≈ 1.333

export interface UsePostDetailResult {
  // 投稿本文 (fetchPostById 由来)
  post: ReturnType<typeof useQuery<Awaited<ReturnType<typeof fetchPostById>>>>['data'];
  postLoading: boolean;
  postError: boolean;
  isRefetching: boolean;
  refetch: () => void;

  // 周辺データ (useFeedPage RPC 由来)
  fullPost: ReturnType<typeof useFeedPage>['fullPosts'] extends Map<string, infer V> ? V | undefined : never;

  // 編集済みバッジ
  editedAt: string | null | undefined;

  // 擬似アイデンティティ
  pseudo: ReturnType<typeof pseudonymFor>;
  officialAuthor: { name?: string | null } | null;

  // リアクション
  reactions: Array<{ meme: string; count: number; mine: boolean }>;
  myMemes: string[];
  toggleReact: (postId: string, meme: string) => void;

  // コミュニティ
  postCommunities: Array<{
    community_id: string;
    name: string;
    icon_emoji?: string | null;
    icon_url?: string | null;
    is_official?: boolean;
  }>;

  // 類似投稿
  similarPosts: Awaited<ReturnType<typeof fetchSimilarPosts>>;

  // コメント
  replies: Comment[];
  repliesLoading: boolean;
  commentTree: ReturnType<typeof buildCommentTree>;
  allCommentIds: string[];
  commentReactions: ReturnType<typeof useCommentReactions>['data'];
  toggleCommentReact: ReturnType<typeof useCommentReactionToggle>['toggle'];

  // 既読ハイライト
  unreadIds: Set<string>;
  lastViewedSnapshot: number | null;

  // UI refs
  scrollRef: React.RefObject<ScrollView>;

  // メディア
  imgAspects: Record<string, number>;
}

/**
 * 投稿詳細画面に必要なデータ取得・副作用・派生状態を束ねる Hook。
 * @param id  有効な UUID。null の場合はほとんどの query が disabled になる。
 */
export function usePostDetail(id: string | null): UsePostDetailResult {
  const qc = useQueryClient();
  const scrollRef = useRef<ScrollView>(null);

  // ----------------------------------------------------------------
  // 投稿本文
  // ----------------------------------------------------------------
  const {
    data: post,
    isLoading: postLoading,
    isError: postError,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: ['post', id],
    queryFn: () => fetchPostById(id!),
    enabled: !!id,
    staleTime: 60_000,
  });

  // ----------------------------------------------------------------
  // 周辺データ (RPC: reactions / communities / is_own など)
  // ----------------------------------------------------------------
  const postIdsForFeedPage = useMemo(() => (id ? [id] : []), [id]);
  const { fullPosts, isLoading: feedPageLoading } = useFeedPage(postIdsForFeedPage);
  const fullPost = id ? fullPosts.get(id) : undefined;

  // ----------------------------------------------------------------
  // 編集済みバッジ
  // ----------------------------------------------------------------
  const { data: editedAt } = useQuery({
    queryKey: ['post-edited-at', id],
    queryFn: () => fetchPostEditedAt(id!),
    enabled: !!id,
    staleTime: 60_000,
  });

  // ----------------------------------------------------------------
  // 擬似アイデンティティ・公式著者
  // ----------------------------------------------------------------
  const pseudo = useMemo(
    () => pseudonymFor(fullPost?.pseudonym_id),
    [fullPost?.pseudonym_id],
  );
  const officialAuthor = fullPost?.official_author ?? post?.official_author ?? null;

  // ----------------------------------------------------------------
  // リアクション
  // ----------------------------------------------------------------
  const reactions = useMemo(
    () => (fullPost?.reactions ?? []) as Array<{ meme: string; count: number; mine: boolean }>,
    [fullPost],
  );
  const myMemes = useMemo(
    () => reactions.filter((r) => r.mine).map((r) => r.meme),
    [reactions],
  );
  const { toggle: toggleReact } = useReactionToggle();

  // ----------------------------------------------------------------
  // コミュニティ (RPC 優先 → fallback HTTP)
  // ----------------------------------------------------------------
  const { data: communitiesByPost = {} } = useQuery({
    queryKey: ['post-communities-of', id],
    queryFn: () => fetchCommunitiesForPosts([id!]),
    enabled: !!id && !feedPageLoading && fullPost?.communities === undefined,
    staleTime: 60_000,
  });
  const postCommunities = useMemo(
    () =>
      (fullPost?.communities ??
        (id ? (communitiesByPost[id] ?? []) : [])) as UsePostDetailResult['postCommunities'],
    [fullPost?.communities, communitiesByPost, id],
  );

  // ----------------------------------------------------------------
  // 類似投稿
  // ----------------------------------------------------------------
  const { data: similarPosts = [] } = useQuery({
    queryKey: ['similar-posts', id, post?.tag_names ?? []],
    queryFn: () => fetchSimilarPosts(id!, post?.tag_names ?? [], 3),
    enabled: !!id && (post?.tag_names?.length ?? 0) > 0,
    staleTime: 60_000,
  });

  // ----------------------------------------------------------------
  // コメント
  // ----------------------------------------------------------------
  const {
    data: replies = [],
    isLoading: repliesLoading,
    refetch: refetchReplies,
    isRefetching: isRefetchingReplies,
  } = useQuery({
    queryKey: ['post-comments', id],
    queryFn: () => fetchComments(id!),
    enabled: !!id,
    staleTime: 30_000,
  });
  const commentTree = useMemo(() => buildCommentTree(replies), [replies]);
  const allCommentIds = useMemo(() => replies.map((r) => r.id), [replies]);
  const { data: commentReactions } = useCommentReactions(allCommentIds);
  const { toggle: toggleCommentReact } = useCommentReactionToggle();

  // ----------------------------------------------------------------
  // 画像アスペクト比 (module-level AnonPostCard cache を seed として利用)
  // ----------------------------------------------------------------
  const mediaUrls = post?.media_urls ?? [];
  const [imgAspects, setImgAspects] = useState<Record<string, number>>(() => {
    const seed: Record<string, number> = {};
    for (const url of mediaUrls) {
      if (!url) continue;
      const r = getCachedAspect(url);
      if (r !== undefined) seed[url] = r;
    }
    return seed;
  });
  // mediaUrls は配列参照が毎回変わるため join した安定 key で依存を表現
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const mediaUrlsKey = mediaUrls.join('|');
  useEffect(() => {
    if (mediaUrls.length === 0) return undefined;
    let alive = true;
    for (const url of mediaUrls) {
      if (!url) continue;
      const cached = getCachedAspect(url);
      if (cached !== undefined) {
        setImgAspects((p) => (p[url] !== undefined ? p : { ...p, [url]: cached }));
        continue;
      }
      RNImage.getSize(
        thumbedUrl(url, 240),
        (w, h) => {
          if (!alive || !(w > 0) || !(h > 0)) return;
          const ratio = Math.max(0.5, Math.min(2.0, w / h));
          setImgAspects((p) => (p[url] !== undefined ? p : { ...p, [url]: ratio }));
        },
        () => { /* getSize 失敗 → DEFAULT_ASPECT のまま */ },
      );
    }
    return () => { alive = false; };
    // mediaUrls は配列参照が毎回変わるため join した安定 key で依存を表現
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaUrlsKey]);

  // ----------------------------------------------------------------
  // lastViewed (既読管理)
  // ----------------------------------------------------------------
  const [lastViewedSnapshot, setLastViewedSnapshot] = useState<number | null>(null);
  const lastViewedSavedRef = useRef(false);

  useEffect(() => {
    if (!id) return undefined;
    setLastViewedSnapshot(getLastViewed('post', id));
    lastViewedSavedRef.current = false;
    const t = setTimeout(() => {
      setLastViewed('post', id);
      lastViewedSavedRef.current = true;
    }, 3000);
    return () => {
      clearTimeout(t);
      if (!lastViewedSavedRef.current) {
        setLastViewed('post', id);
      }
    };
  }, [id]);

  // ----------------------------------------------------------------
  // 未読 ID 集合
  // ----------------------------------------------------------------
  const unreadIds = useMemo(() => {
    if (lastViewedSnapshot === null) return new Set<string>();
    const set = new Set<string>();
    for (let i = 0; i < replies.length; i++) {
      const c = replies[i];
      if (!c) continue;
      const created = Date.parse(c.created_at);
      if (Number.isFinite(created) && created > lastViewedSnapshot) {
        set.add(c.id);
      }
    }
    return set;
  }, [replies, lastViewedSnapshot]);

  // ----------------------------------------------------------------
  // Realtime — コメント/投稿本体/リアクション (1 channel, 3 .on())
  // ----------------------------------------------------------------
  useEffect(() => {
    if (!id) return;
    const detach = attachChannel(`post-detail-bundle:${id}`, (ch) =>
      ch
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'comments', filter: `post_id=eq.${id}` },
          () => qc.invalidateQueries({ queryKey: ['post-comments', id] }),
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'posts', filter: `id=eq.${id}` },
          () => qc.invalidateQueries({ queryKey: ['post', id] }),
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'post_reactions', filter: `post_id=eq.${id}` },
          () => invalidateFeedPage(qc),
        ),
    );
    return () => {
      try { detach(); } catch (e) { swallow('post-detail.realtime.detach', e); }
    };
  }, [id, qc]);

  // ----------------------------------------------------------------
  // refetch を ScrollView RefreshControl と共有するため結合して返す
  // ----------------------------------------------------------------
  const refetchAll = () => {
    void refetchReplies();
    void refetch();
  };

  return {
    post,
    postLoading,
    postError,
    isRefetching: isRefetching || isRefetchingReplies,
    refetch: refetchAll,
    fullPost: fullPost as UsePostDetailResult['fullPost'],
    editedAt,
    pseudo,
    officialAuthor: officialAuthor as UsePostDetailResult['officialAuthor'],
    reactions,
    myMemes,
    toggleReact,
    postCommunities,
    similarPosts,
    replies,
    repliesLoading,
    commentTree,
    allCommentIds,
    commentReactions: (commentReactions ?? {}) as UsePostDetailResult['commentReactions'],
    toggleCommentReact,
    unreadIds,
    lastViewedSnapshot,
    scrollRef,
    imgAspects,
  };
}

// DEFAULT_ASPECT はモジュール外から参照できるようにエクスポート
export { DEFAULT_ASPECT };
