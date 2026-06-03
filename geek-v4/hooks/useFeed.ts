import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { fetchPosts, fetchCommunitiesForPosts } from '../lib/api/posts';
import { supabase } from '../lib/supabase';
import { attachChannel } from '../lib/realtime';
import { useTagFilterStore } from '../stores/tagFilterStore';
import { useFeedStore } from '../stores/feedStore';
import { useSearchSignalsStore } from '../stores/searchSignalsStore';
import { useSearchClickStore } from '../stores/searchClickStore';
import { useTagCooccurStore } from '../stores/tagCooccurStore';
import { smartSort } from '../lib/feed/smartRank';
import { GOSSIP_TRENDING_BLOCKLIST_SET } from '../stores/tagFilterStore';
import { deepNormalize } from '../lib/search/tokenize';
import type { Post } from '../types/models';
import { useQuery as useReactQuery } from '@tanstack/react-query';
import { getEvents, computeProfile, rankFeed, computePostScore, diversifyFeed } from '../lib/personalize';
import type { FeedEvent, RankableCandidate, RankReason } from '../lib/personalize';
import { useAuthStore } from '../stores/authStore';
import { fetchTargetedAds, type Ad } from '../lib/api/ads';
import { useAdPreferencesStore } from '../stores/adPreferencesStore';
import { rankByRising } from '../lib/utils/risingScore';

// React Query の persist cache は JSON 経由なので Set を直接保存できない (空の {} になる)。
// 配列で返して使い側で Set に包む。
//
// Audit G#7 (2026-05): 以前は posts table を per-session で 24h 集計していたが、
// 0071_trending_cron.sql で mv_trending_tags の 5 分毎 refresh を登録したので、
// MV から直接読む経路に切り替え。クライアント CPU + DB read を大幅削減。
// MV columns: tag (text, unique), recent_count (bigint), last_seen (timestamptz)
async function fetchTrendingTagList(): Promise<string[]> {
  const { data } = await supabase
    .from('mv_trending_tags')
    .select('tag, recent_count')
    .order('recent_count', { ascending: false })
    .limit(200);
  // ゴシップ/事件報道系のキーワード — 部分一致でもブロック
  const gossipTriggers = ['炎上', '逮捕', '訃報', '不倫', '浮気', '熱愛', 'スキャンダル', 'スクープ', '事件', '殺人', '死亡', '訴訟', '謝罪'];
  const isGossip = (tag: string) => {
    if (GOSSIP_TRENDING_BLOCKLIST_SET.has(tag)) return true;
    for (const trig of gossipTriggers) if (tag.includes(trig)) return true;
    return false;
  };
  const result: string[] = [];
  for (const row of (data ?? []) as Array<{ tag: string; recent_count: number }>) {
    if (!row.tag) continue;
    if (isGossip(row.tag)) continue;
    // 元実装は count >= 2 を閾値にしていたので踏襲 (1 回しか出てないタグは trending と呼ばない)
    if ((row.recent_count ?? 0) < 2) continue;
    result.push(row.tag);
  }
  return result;
}

export function useFeed() {
  // selector: tagFilter には addBlocked / removeBlocked など action もあるため、全体
  // destructure は使わず必要な値だけ subscribe する
  const likedTags = useTagFilterStore((s) => s.likedTags);
  const blockedTags = useTagFilterStore((s) => s.blockedTags);
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
    // staleTime 0: リロード/再フォーカスのたびに page1 を取り直して新着を反映する
    // (refetchOnMount:true + feed.tsx の focus invalidate と協調)。keepPreviousData で空 flicker は無し。
    staleTime: 0,
    // ★ パフォーマンス改善: sort / scope / liked/blocked タグ切替時に
    //   前回 page を表示しながら裏 fetch — 空 list flicker を回避。
    //   v5 では keepPreviousData を placeholderData に渡すのが標準。
    placeholderData: keepPreviousData,
  });

  // data.pages は React Query が変更時のみ新参照を返すが、flatMap は毎回新配列を作る。
  // 中身 (post 配列) が同じなら同じ参照を保ちたいので、pages 参照を deps にした useMemo で安定化。
  // これで下流の useMemo (smartSort, postIds 等) が無駄に再計算されない。
  //
  // ★ ページ境界の重複 id を de-dup する (FlashList key 衝突対策)。
  //   cursor pagination の tie-break 漏れ (top は `likes_count|created_at`、hot は
  //   `hot_score|created_at` で id の二次キーを持たないため同値タイで境界が重なる) や、
  //   ページ取得間の hot_score drift で、同一 post が複数ページに跨って返ることがある。
  //   重複 id があると FlashList の keyExtractor が同じ key を 2 回返し、
  //   RecyclerListView が衝突回避キー (`#<n>_rlv_c`, n は単調増加) を毎データ更新で
  //   再生成 → React の "same key" 警告がコンソールをフラッドし、表示崩れ (行の重複/欠落)
  //   も招く。Set で最初の 1 件だけ残して一意化する (表示順は先勝ちで維持)。
  const rawPosts: Post[] = useMemo(() => {
    const flat = data?.pages.flatMap((p) => p.posts) ?? [];
    const seen = new Set<string>();
    const deduped: Post[] = [];
    for (const p of flat) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      deduped.push(p);
    }
    // 重複が無ければ元配列をそのまま返したいところだが、flat 自体が毎回新参照なので
    // ここで作る deduped を返しても下流の安定化 (postIdsHash) は効く。
    return deduped;
  }, [data?.pages]);

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
    // postIds 集合が変わるたびに community メタを 1 round-trip で取り直すが、
    // 前回 hash の結果を表示し続けて UI から community badge が消えないように。
    placeholderData: keepPreviousData,
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

  // Phase 2: cluster signal (cooccur) を Feed の scoring に渡す
  // - cooccur store の hydrate は他箇所 (tag-graph 画面) で kick されるが、
  //   for-you ソート時にも欲しいので念のため hydrate を試行
  // - interest 集合: likedTags + 高 affinity (>1.0) tag を normalize して 1 set
  const cooccur = useTagCooccurStore((s) => s.cooccur);
  const cooccurHydrate = useTagCooccurStore((s) => s.hydrate);
  const cooccurEnsureFresh = useTagCooccurStore((s) => s.ensureFresh);
  const cooccurHydrated = useTagCooccurStore((s) => s.hydrated);
  useEffect(() => { void cooccurHydrate(); }, [cooccurHydrate]);
  useEffect(() => {
    if (cooccurHydrated && sort === 'for-you') void cooccurEnsureFresh();
  }, [cooccurHydrated, cooccurEnsureFresh, sort]);

  const interestTagsNorm = useMemo(() => {
    const s = new Set<string>();
    for (const t of likedTags) {
      const n = deepNormalize(t);
      if (n) s.add(n);
    }
    // profile.tagAffinity のキーは既に normalized
    for (const [tag, value] of Object.entries(profile.tagAffinity)) {
      if (value > 1) s.add(tag);
    }
    return s;
  }, [likedTags, profile.tagAffinity]);

  // ----------------------------------------------------------------
  // YouTube-style ranking 用の補助 input
  // - userLikedTagsFreq: profile.tagAffinity からそのまま借りる
  //   (events.ts は post_like 等で各タグに重み w を加算するので「いいねした回数」の
  //    近似として使える。完全に等しくはないが Map<tag, number> として意味が一致)
  // - globalTagFreq: 現在 feed に乗っている post の tag 出現数。本来は全 DB 集計
  //   が望ましいが、(a) 余計な fetch を増やしたくない (b) feed 内分布で十分 IDF が
  //   効く ので近似で済ませる
  // - myAccountAgeDays: auth user の created_at から計算
  // ----------------------------------------------------------------
  // ★ zustand selector の中で Date.now() を使うと毎 render 値が変わって infinite
  //   re-render loop (React error #185) になる. selector は stable な created_at
  //   だけ取り出し, day 数の計算は useMemo に閉じ込める. integer 化で 1 日に 1 回
  //   だけ値が変わるので下流の useMemo も無駄に走らない.
  const userCreatedAt = useAuthStore((s) => s.user?.created_at);
  const myAccountAgeDays = useMemo(() => {
    if (!userCreatedAt) return 0;
    const t = new Date(userCreatedAt).getTime();
    if (!Number.isFinite(t)) return 0;
    return Math.floor(Math.max(0, (Date.now() - t) / 86_400_000));
  }, [userCreatedAt]);

  const { posts, reasonsMap }: { posts: Post[]; reasonsMap: Record<string, RankReason> } = useMemo(() => {
    // ----------------------------------------------------------------
    // Rising モード: 直近 3 時間以内の post を「likes/分」速度で再ランクして上位 30 件
    // ----------------------------------------------------------------
    // - blocked タグはまず除外 (smartSort 等と同じ contract)
    // - DB schema は触らず client side のみで動く (rankByRising は pure)
    // - server から fetchPosts は created_at desc limit 100 で 1 ページのみ取得
    //   している前提 (lib/api/posts.ts の isRising 分岐)
    if (sort === 'rising') {
      const blockedSet = new Set(blockedTags);
      const visiblePosts = rawPosts.filter((p) => {
        const tags = p.tag_names ?? [];
        for (const t of tags) if (blockedSet.has(t)) return false;
        return true;
      });
      const ranked = rankByRising(visiblePosts, Date.now());
      return { posts: ranked, reasonsMap: {} };
    }

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
        // Phase 2: cluster cooccur signal
        cooccur,
        interestTagsNorm,
      });
      const byId: Record<string, Post> = {};
      for (const p of visiblePosts) byId[p.id] = p;
      const reasons: Record<string, RankReason> = {};
      // rankFeed 経由で reasonsMap を確保 (UI の説明文用)
      for (const s of ranked) reasons[s.id] = s.reason;

      // ----------------------------------------------------------------
      // Phase 3: YouTube-style re-rank + diversity
      // 1) tag affinity (Jaccard × TF-IDF), engagement (log scale),
      //    time decay (HN), fresh boost, fresh-user noise を 1 score に
      // 2) diversifyFeed で同 author / 同 dominant tag の連続を抑制
      // ----------------------------------------------------------------
      const userLikedTagsFreq = new Map<string, number>(
        Object.entries(profile.tagAffinity),
      );
      const globalTagFreq = new Map<string, number>();
      for (const p of visiblePosts) {
        for (const t of p.tag_names ?? []) {
          const n = deepNormalize(t);
          if (!n) continue;
          globalTagFreq.set(n, (globalTagFreq.get(n) ?? 0) + 1);
        }
      }
      const now = new Date();
      const scoredPosts: Array<{ post: Post; score: number }> = visiblePosts.map((p) => ({
        post: p,
        score: computePostScore({
          post: p,
          userLikedTagsFreq,
          globalTagFreq,
          now,
          myAccountAgeDays,
          totalPosts: visiblePosts.length,
        }),
      }));
      const diversified = diversifyFeed(scoredPosts, 2);

      // rankFeed が拾えなかった post (= reason が無いもの) は「新着」扱いに
      const ordered: Post[] = [];
      const pickedIds = new Set<string>();
      for (const p of diversified) {
        ordered.push(p);
        pickedIds.add(p.id);
        if (!reasons[p.id]) reasons[p.id] = { kind: 'fresh', text: '新着' };
      }
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
  }, [rawPosts, sort, likedTags, blockedTags, signals.tagFreq, signals.recentTags, trendingTags, ctrBoosts, profile, cooccur, interestTagsNorm, myAccountAgeDays]);

  // ----------------------------------------------------------------
  // タグターゲティング広告 — プライバシー保護 (個人 id は送らず、タグだけで配信)
  // ----------------------------------------------------------------
  // ユーザーが opt-out した場合は fetch 自体をスキップする。
  // 興味タグは tagFreq の上位 10 件 (関心度の高い順)。
  // exclude は blockedTags そのまま渡す。
  const personalizedAds = useAdPreferencesStore((s) => s.personalizedAds);
  const interestTags = useMemo(() => {
    return Object.entries(signals.tagFreq)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([t]) => t);
  }, [signals.tagFreq]);
  // クエリキーが「興味タグの中身」で安定するよう、文字列で hash 化する。
  const interestTagsKey = interestTags.join('|');
  const blockedTagsKey = blockedTags.join('|');
  const adsQ = useReactQuery<Ad[]>({
    queryKey: ['ads', interestTagsKey, blockedTagsKey],
    queryFn: () => fetchTargetedAds(interestTags, blockedTags, 3),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    enabled: personalizedAds,
  });
  // ads 配列を ID hash で安定化 — 同じ id の集合が返ってくる限り
  // 参照が変わらず、下流の useMemo (feed の merge 等) が無駄に再評価されない。
  const adsIdHash = (adsQ.data ?? []).map((a) => a.id).join('|');
  const ads: Ad[] = useMemo(() => adsQ.data ?? [], [adsIdHash]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetching) fetchNextPage();
  }, [hasNextPage, isFetching, fetchNextPage]);

  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  // Realtime: posts UPDATE (likes/comments/concern カウント変動) のみ subscribe。
  // INSERT (新規投稿) は filter 不可で全 fanout が痛いため撤去 (Audit E#5)。
  // 新規投稿の取り込みは pull-to-refresh + tab focus invalidate + staleTime に委譲。
  //
  // フィードに見えてる post だけを server-side filter で絞る — 全 post の UPDATE を
  // 受け取ると fanout が O(全ユーザー × 全 post 更新) になりサーバーが死ぬ。
  //
  // postIds の変化で頻繁に再 subscribe するのは避けたい (channel teardown コストが高い)
  // ので、firstPageIds (上位 30 件 = 最も活発な投稿) を deps にして安定化する。
  // 下に scroll しても再 subscribe しない — fetch 経由の値が staleTime 後に更新される。
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
    // ★ Audit E#5 (2026-05-28):
    //   旧版は同 channel で UPDATE (filter あり) + INSERT (filter なし) を chain。
    //   posts INSERT は全クライアントに fanout され重いので realtime 撤去。
    //   新規投稿の取り込みは pull-to-refresh + staleTime + tab focus invalidate に委譲
    //   (feed.tsx の useFocusEffect で `qc.invalidateQueries({ queryKey: ['feed'] })`)。
    //   UPDATE (filter 付き) は active な反応カウント変動を見せる主要 UX なので残す。
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
      ),
    );
    return () => {
      detach();
      if (updateFlushTimer.current) clearTimeout(updateFlushTimer.current);
      updateBuffer.current.clear();
    };
    // ★ firstPageIds は useMemo の参照だが firstPageKey が中身を含意するので
    //   deps から外す (再 render churn を避け Supabase pool 枯渇を予防).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstPageKey, qc]);

  return { posts, reasonsMap, communitiesByPost, ads, interestTags, loading: isLoading, refreshing, refresh, loadMore };
}
