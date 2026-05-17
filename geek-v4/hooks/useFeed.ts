import { useCallback, useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { fetchPosts } from '@/lib/api/posts';
import { supabase } from '@/lib/supabase';
import { useTagFilterStore } from '@/stores/tagFilterStore';
import { useFeedStore } from '@/stores/feedStore';
import type { Post } from '@/types/models';

export function useFeed() {
  const { likedTags, blockedTags } = useTagFilterStore();
  const sort = useFeedStore((s) => s.sort);
  const scope = useFeedStore((s) => s.scope);
  const qc = useQueryClient();

  const filterTags = scope === 'closed' && likedTags.length > 0 ? likedTags : undefined;

  const { data, isLoading, isFetching, fetchNextPage, hasNextPage, refetch } = useInfiniteQuery({
    queryKey: ['feed', sort, scope, likedTags, blockedTags],
    queryFn: ({ pageParam }) =>
      fetchPosts({ sort, likedTags, blockedTags, filterTags, cursor: pageParam as string | undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 30_000,
  });

  const posts: Post[] = data?.pages.flatMap((p) => p.posts) ?? [];

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetching) fetchNextPage();
  }, [hasNextPage, isFetching, fetchNextPage]);

  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  // Realtime: posts UPDATE (likes/comments/concern カウント変動) と INSERT (新規投稿)
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const channel = supabase
      .channel('feed-posts')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'posts' },
        (payload) => {
          const updated = payload.new as Partial<Post> & { id: string };
          // 該当 post をキャッシュ内で局所更新
          qc.setQueriesData({ queryKey: ['feed'] }, (data: unknown) => {
            if (!data || typeof data !== 'object') return data;
            const old = data as { pages?: Array<{ posts: Post[] }> };
            if (!old.pages) return data;
            return {
              ...old,
              pages: old.pages.map((p) => ({
                ...p,
                posts: p.posts.map((post) => (post.id === updated.id ? { ...post, ...updated } : post)),
              })),
            };
          });
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'posts' },
        () => {
          // 新規投稿は debounce で再フェッチ (連投時の連続再取得を回避)
          if (pendingTimer.current) clearTimeout(pendingTimer.current);
          pendingTimer.current = setTimeout(() => {
            qc.invalidateQueries({ queryKey: ['feed'] });
          }, 1500);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
    };
  }, [qc]);

  return { posts, loading: isLoading, refreshing, refresh, loadMore };
}
