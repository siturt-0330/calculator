import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { fetchPosts } from '@/lib/api/posts';
import { supabase } from '@/lib/supabase';
import { attachChannel } from '@/lib/realtime';
import { useTagFilterStore } from '@/stores/tagFilterStore';
import { useFeedStore } from '@/stores/feedStore';
import { useSearchSignalsStore } from '@/stores/searchSignalsStore';
import { useSearchClickStore } from '@/stores/searchClickStore';
import { smartSort } from '@/lib/feed/smartRank';
import type { Post } from '@/types/models';
import { useQuery as useReactQuery } from '@tanstack/react-query';
import { getEvents, computeProfile, rankFeed } from '@/lib/personalize';
import type { FeedEvent, RankableCandidate, RankReason } from '@/lib/personalize';

// React Query の persist cache は JSON 経由なので Set を直接保存できない (空の {} になる)。
// 配列で返して使い側で Set に包む。
async function fetchTrendingTagList(): Promise<string[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('posts')
    .select('tag_names')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(200);
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as Array<{ tag_names: string[] }>) {
    for (const t of row.tag_names ?? []) counts[t] = (counts[t] ?? 0) + 1;
  }
  return Object.entries(counts).filter(([, c]) => c >= 2).map(([t]) => t);
}

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

  const rawPosts: Post[] = data?.pages.flatMap((p) => p.posts) ?? [];

  // Smart Rank: 全 sort モードで個人化スコアを適用 (mode により primary 軸の重みを切替)
  const aggregate = useSearchSignalsStore((s) => s.aggregate);
  const signals = useMemo(() => aggregate(), [aggregate]);
  // CTR タグ集計: 全ての過去クエリのタグクリック数を合計
  const queryToTagCount = useSearchClickStore((s) => s.queryToTagCount);
  const ctrBoosts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const tagMap of Object.values(queryToTagCount)) {
      for (const [tag, count] of Object.entries(tagMap)) m[tag] = (m[tag] ?? 0) + count;
    }
    return m;
  }, [queryToTagCount]);
  // トレンドタグ (string[] でキャッシュ → 使う時に Set へ包む)
  const trendingQ = useReactQuery({
    queryKey: ['trending-tag-list'],
    queryFn: fetchTrendingTagList,
    staleTime: 5 * 60 * 1000,
  });
  const trendingTags = useMemo(() => new Set(trendingQ.data ?? []), [trendingQ.data]);

  // ----------------------------------------------------------------
  // For-You: 端末ローカルのイベントログから interest profile を組んで再ランク
  // ----------------------------------------------------------------
  const eventsQ = useReactQuery<FeedEvent[]>({
    queryKey: ['feed-events'],
    queryFn: () => getEvents(),
    staleTime: 30_000,
    enabled: sort === 'for-you',
  });
  const events = useMemo(() => eventsQ.data ?? [], [eventsQ.data]);
  const profile = useMemo(() => computeProfile(events), [events]);

  const { posts, reasonsMap }: { posts: Post[]; reasonsMap: Record<string, RankReason> } = useMemo(() => {
    if (sort === 'for-you') {
      // For-You は personalize 基盤で再ランク。blocked タグはクライアント側で先に除去。
      const blockedSet = new Set(blockedTags);
      const visiblePosts = rawPosts.filter((p) => {
        const tags = p.tag_names ?? [];
        for (const t of tags) if (blockedSet.has(t)) return false;
        return true;
      });

      const candidates: RankableCandidate[] = visiblePosts.map((p) => ({
        id: p.id,
        tags: p.tag_names ?? [],
        created_at: p.created_at,
        like_count: p.likes_count ?? 0,
        reply_count: p.comments_count ?? 0,
        trust_score_at_post: p.trust_score_at_post ?? null,
      }));
      const ranked = rankFeed(candidates, profile, {
        now: Date.now(),
        trendingTags,
        targetCount: visiblePosts.length,
      });
      const byId: Record<string, Post> = {};
      for (const p of visiblePosts) byId[p.id] = p;
      const ordered: Post[] = [];
      const reasons: Record<string, RankReason> = {};
      const pickedIds = new Set<string>();
      for (const s of ranked) {
        const p = byId[s.id];
        if (!p) continue;
        ordered.push(p);
        reasons[s.id] = s.reason;
        pickedIds.add(s.id);
      }
      // ランカーが拾い切れなかった残りは末尾に追加 (見落としを避ける)
      for (const p of visiblePosts) {
        if (!pickedIds.has(p.id)) ordered.push(p);
      }
      return { posts: ordered, reasonsMap: reasons };
    }

    const likedSet = new Set(likedTags);
    const blockedSet = new Set(blockedTags);
    // 全モードで個人化を適用。mode 引数で primary 軸 (hot=バランス / new=鮮度 / top=反応量) を切り替える。
    const sorted = smartSort(rawPosts, {
      likedTags: likedSet,
      blockedTags: blockedSet,
      tagAffinity: signals.tagFreq,
      recentTags: signals.recentTags,
      recentQueries: [],
      trendingTags,
      ctrBoosts,
    }, sort);
    return { posts: sorted, reasonsMap: {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawPosts, sort, likedTags, blockedTags, signals.tagFreq, signals.recentTags, trendingTags, ctrBoosts, profile]);

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
    const detach = attachChannel('feed-posts', (ch) =>
      ch.on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'posts' },
        (payload) => {
          const updated = payload.new as Partial<Post> & { id: string };
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
      ).on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'posts' },
        () => {
          // 新規投稿は debounce で再フェッチ (連投時の連続再取得を回避)
          if (pendingTimer.current) clearTimeout(pendingTimer.current);
          pendingTimer.current = setTimeout(() => {
            qc.invalidateQueries({ queryKey: ['feed'] });
          }, 1500);
        },
      ),
    );
    return () => {
      detach();
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
    };
  }, [qc]);

  return { posts, reasonsMap, loading: isLoading, refreshing, refresh, loadMore };
}
