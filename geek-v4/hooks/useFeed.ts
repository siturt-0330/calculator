import { useCallback, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { fetchPosts } from '@/lib/api/posts';
import { useTagFilterStore } from '@/stores/tagFilterStore';
import { useFeedStore } from '@/stores/feedStore';
import type { Post } from '@/types/models';

export function useFeed() {
  const { likedTags, blockedTags } = useTagFilterStore();
  const mode = useFeedStore((s) => s.mode);
  const qc = useQueryClient();

  const { data, isLoading, isFetching, fetchNextPage, hasNextPage, refetch } = useInfiniteQuery({
    queryKey: ['feed', mode, likedTags, blockedTags],
    queryFn: ({ pageParam }) =>
      fetchPosts({ mode, likedTags, blockedTags, cursor: pageParam as string | undefined }),
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

  return { posts, loading: isLoading, refreshing, refresh, loadMore };
}
