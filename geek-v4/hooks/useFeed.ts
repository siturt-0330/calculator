import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { fetchPosts, fetchCommunitiesForPosts } from '../lib/api/posts';
import { supabase } from '../lib/supabase';
import { attachChannel } from '../lib/realtime';
import { useTagFilterStore } from '../stores/tagFilterStore';
import { useFeedStore } from '../stores/feedStore';
import { useSearchSignalsStore } from '../stores/searchSignalsStore';
import { useSearchClickStore } from '../stores/searchClickStore';
import { smartSort } from '../lib/feed/smartRank';
import type { Post } from '../types/models';
import { useQuery as useReactQuery } from '@tanstack/react-query';
import { getEvents, computeProfile, rankFeed } from '../lib/personalize';
import type { FeedEvent, RankableCandidate, RankReason } from '../lib/personalize';

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

  // ホームフィード — fetchPosts は home=true (デフォルト) で
  // visibility IN ('public', 'community_public') の post だけ返す。
  // private / community_only はサーバー側で弾かれる。
  const { data, isLoading, isFetching, fetchNextPage, hasNextPage, refetch } = useInfiniteQuery({
    queryKey: ['feed', sort, scope, likedTags, blockedTags],
    queryFn: ({ pageParam }) =>
      fetchPosts({ sort, likedTags, blockedTags, filterTags, cursor: pageParam as string | undefined, home: true }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 30_000,
  });

  // data.pages は React Query が変更時のみ新参照を返すが、flatMap は毎回新配列を作る。
  // 中身 (post 配列) が同じなら同じ参照を保ちたいので、pages 参照を deps にした useMemo で安定化。
  // これで下流の useMemo (smartSort, postIds 等) が無駄に再計算されない。
  const rawPosts: Post[] = useMemo(
    () => data?.pages.flatMap((p) => p.posts) ?? [],
    [data?.pages],
  );

  // 各 post に紐付いた community のメタを 1 リクエストで取得 (FlashList N+1 回避)
  // postIds が空のうちは fetch しない (enabled で抑止)
  // ID リストの中身が変わらない render では同じ参照を保つ (hash で安定化)
  const postIdsHash = rawPosts.map((p) => p.id).join('|');
  const postIds = useMemo(() => rawPosts.map((p) => p.id), [postIdsHash]); // eslint-disable-line react-hooks/exhaustive-deps
  const communitiesQ = useReactQuery({
    queryKey: ['feed-post-communities', postIdsHash],
    queryFn: () => fetchCommunitiesForPosts(postIds),
    enabled: postIds.length > 0,
    staleTime: 60_000,
  });
  const communitiesByPost = communitiesQ.data ?? {};

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
  // フィードに見えてる post だけを server-side filter で絞る — 全 post の UPDATE を
  // 受け取ると fanout が O(全ユーザー × 全 post 更新) になりサーバーが死ぬ。
  //
  // postIds の変化で頻繁に再 subscribe するのは避けたい (channel teardown コストが高い)
  // ので、firstPageIds (上位 30 件 = 最も活発な投稿) を deps にして安定化する。
  // 下に scroll しても再 subscribe しない — fetch 経由の値が staleTime 後に更新される。
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // UPDATE event coalescing — multiple postgres_changes UPDATE events within
  // 250ms are merged into a single setQueriesData call.  Previously each
  // UPDATE re-allocated the entire pages/posts tree which thrashed React
  // during scroll. Now we buffer partial updates by id and flush them on
  // rAF after a short debounce.
  const updateBuffer = useRef<Map<string, Partial<Post>>>(new Map());
  const updateFlushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visiblePostIdsRef = useRef<Set<string>>(new Set());
  // 現在表示中の全 post id を ref に同期 (UPDATE handler の client-side filter 用)
  useEffect(() => {
    visiblePostIdsRef.current = new Set(postIds);
  }, [postIds]);
  // server filter 用: 上位 30 件のみ。
  // - 多すぎると filter 文字列が長くなり Realtime のフィルタ長制限に抵触
  // - 上位 30 件が最も active な投稿 (反応カウントが頻繁に変わる) なので
  //   それだけ server から受け取れれば 99% カバーできる
  const firstPageIds = useMemo(() => postIds.slice(0, 30), [postIds]);
  const firstPageKey = firstPageIds.join(',');
  useEffect(() => {
    // 何も表示してない時は subscribe しない
    if (firstPageIds.length === 0) return;
    const channelName = `feed-posts:${firstPageKey.slice(0, 64)}`;
    const detach = attachChannel(channelName, (ch) =>
      ch.on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'posts',
          filter: `id=in.(${firstPageIds.join(',')})`,
        },
        (payload) => {
          const updated = payload.new as Partial<Post> & { id: string };
          // 念のためクライアント側でも再チェック (filter が反映遅延した場合の保険)
          if (!visiblePostIdsRef.current.has(updated.id)) return;
          // バッファに溜めて 250ms debounce で一括反映 — スクロール中に
          // 大量の UPDATE が来ても React 再 render は 1 回に集約される
          const existing = updateBuffer.current.get(updated.id);
          updateBuffer.current.set(updated.id, { ...(existing ?? {}), ...updated });
          if (updateFlushTimer.current) return;
          updateFlushTimer.current = setTimeout(() => {
            updateFlushTimer.current = null;
            const patches = updateBuffer.current;
            if (patches.size === 0) return;
            updateBuffer.current = new Map();
            qc.setQueriesData({ queryKey: ['feed'] }, (data: unknown) => {
              if (!data || typeof data !== 'object') return data;
              const old = data as { pages?: Array<{ posts: Post[] }> };
              if (!old.pages) return data;
              // どの page にも該当 id が無ければ早期 return で参照を維持
              let touched = false;
              const newPages = old.pages.map((p) => {
                let pageTouched = false;
                const newPosts = p.posts.map((post) => {
                  const patch = patches.get(post.id);
                  if (!patch) return post;
                  pageTouched = true;
                  return { ...post, ...patch };
                });
                if (!pageTouched) return p;
                touched = true;
                return { ...p, posts: newPosts };
              });
              return touched ? { ...old, pages: newPages } : data;
            });
          }, 250);
        },
      ).on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'posts' },
        () => {
          // 新規投稿は debounce で再フェッチ (連投時の連続再取得を回避)
          // INSERT は filter 不可 (新規 id は事前に知り得ない) のため、サーバー filter を
          // かけられないが、debounce で fetch を集約することで実害は最小化される。
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
      if (updateFlushTimer.current) clearTimeout(updateFlushTimer.current);
      updateBuffer.current.clear();
    };
  }, [firstPageKey, firstPageIds, qc]);

  return { posts, reasonsMap, communitiesByPost, loading: isLoading, refreshing, refresh, loadMore };
}
