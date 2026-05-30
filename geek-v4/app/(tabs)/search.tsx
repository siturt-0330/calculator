// ============================================================
// (tabs)/search.tsx — 「Geek 内を検索」 (Google 検索 inspired, iOS-native)
// ------------------------------------------------------------
// 設計思想:
//   - 入力 empty: Discovery (Trending / Hot / おすすめコミュ / カテゴリ / ForYou)
//   - 入力あり (focus + empty): 最近の検索 5-10 件 + 候補
//   - 入力あり: useSearchV4 で「投稿 / コミュニティ」のグルーピング結果
//   - iOS native ぽい sticky search bar (radius 12) + 拡大鏡 / clear / voice icon
//
// 検索 UX:
//   - 200ms debounce で query を確定
//   - 履歴は useSearchHistory (MMKV / autocomplete LRU を wrap)
//   - 結果 0 件は「もしかして…」 (synonym 候補) + 「フィルタを緩める」
//
// v4 連携 (このリビジョン):
//   1) useSearchV4 — 多 signal ランキング (text_relevance / recency / eeat /
//      usability / safety_negation / freshness / diversity_penalty / etc.)
//   2) useQueryIntent — クエリ意図を控えめに表示 ("intent: 〇〇")
//   3) useLogSearchEngagement — impression / click / dwell を server に送信
//      (fire-and-forget, retry なし)
//   4) RankingExplainer — 各 row の ⓘ アイコンから「なぜこの結果?」modal
//   5) useSearchPreferences — diversify_results を v4 に渡す
//   6) community filter — `?community=<id>` で受けて scope 付き検索
//
// 担当外:
//   - components/search/* (C3 が拡張)
//   - lib/api/* (C2 が拡張) — 本ファイルは hook 経由でのみ参照
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  RefreshControl,
  Keyboard,
} from 'react-native';
import { useSharedValue, withTiming } from 'react-native-reanimated';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PressableScale } from '../../components/ui/PressableScale';
import { Icon } from '../../constants/icons';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { fetchPostById } from '../../lib/api/posts';
// EDITORIAL「特集」検索 UI コンポーネント群
import { InklineSearchBar } from '../../components/search/InklineSearchBar';
import { EditorialMasthead } from '../../components/search/EditorialMasthead';
import { CategoryRunningHead } from '../../components/search/CategoryRunningHead';
import { EditorialPostCard } from '../../components/search/EditorialPostCard';
import { EditorialCommunityRow } from '../../components/search/EditorialCommunityRow';
import { EditorialSkeleton } from '../../components/search/EditorialSkeleton';
import { EditorialEmpty } from '../../components/search/EditorialEmpty';
import {
  searchCommunities,
  discoverCommunities,
  fetchRisingCommunities,
  fetchOfficialCommunities,
  type CommunityHit,
} from '../../lib/api/communities';
import { useSearchHistory } from '../../hooks/useSearchHistory';
import { useMyCommunityIds } from '../../hooks/useMyCommunityIds';
import { useJoinCommunity } from '../../hooks/useJoinCommunity';
import {
  useSearchV4,
  useQueryIntent,
  useLogSearchEngagement,
} from '../../hooks/useSearchV4';
import { useTrendingTopics } from '../../hooks/useSearchV2';
import { useSearchPreferences } from '../../hooks/useSearchPreferences';
import { useSearchSignalsStore } from '../../stores/searchSignalsStore';
import { findClosest } from '../../lib/search/typoCorrect';
import { useTagGraphStore } from '../../stores/tagGraphStore';
import type { Post } from '../../types/models';
// Discovery セクション (C3 担当 — props で連携)
import { HotPostsRow } from '../../components/search/HotPostsRow';
import { CommunityShelf } from '../../components/search/CommunityShelf';
import { InterestCategories } from '../../components/search/InterestCategories';
import { ForYouShelf } from '../../components/search/ForYouShelf';
import { RankingExplainer } from '@/components/search/RankingExplainer';

// 検索 input の debounce — typing 中の不要な fetch を抑える
const DEBOUNCE_MS = 200;
// 結果セクションあたりの初期表示件数 (「もっと見る」で展開)
const PREVIEW_LIMIT = 5;

type ResultCategory = 'all' | 'posts' | 'communities';

// 発行メタ「VOL.{ISO週番号} ／ {M月D日}」用の ISO 週番号算出 (誌面マストヘッド)
function getISOWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  return 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
}

// ============================================================
// SearchScreen
// ============================================================
export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ q?: string; community?: string }>();
  const qc = useQueryClient();

  // ============= state =============
  const [rawQuery, setRawQuery] = useState<string>(typeof params.q === 'string' ? params.q : '');
  const [debouncedQuery, setDebouncedQuery] = useState<string>(typeof params.q === 'string' ? params.q : '');
  const [inputFocused, setInputFocused] = useState<boolean>(false);
  const [category, setCategory] = useState<ResultCategory>('all');
  const [expandPosts, setExpandPosts] = useState<boolean>(false);
  const [expandCommunities, setExpandCommunities] = useState<boolean>(false);
  const inputRef = useRef<TextInput | null>(null);
  // RankingExplainer modal — どの post の説明を開いているか
  const [explainPost, setExplainPost] = useState<{ id: string; query: string } | null>(null);
  // URL ?community=<id> で community scope filter を効かせる
  const communityId = typeof params.community === 'string' && params.community.length > 0
    ? params.community
    : undefined;

  // ============= 履歴 / シグナル =============
  const {
    history,
    pickQuery,
    removeQuery,
    clearAll,
  } = useSearchHistory(10);
  const recordSignal = useSearchSignalsStore((s) => s.record);
  const hydrateGraph = useTagGraphStore((s) => s.hydrate);

  useEffect(() => {
    void hydrateGraph();
  }, [hydrateGraph]);

  // ============= URL `?q=` で初期化 =============
  useEffect(() => {
    const q = typeof params.q === 'string' ? params.q : '';
    if (q && q !== rawQuery) {
      setRawQuery(q);
      setDebouncedQuery(q);
    }
    // 初回 mount 限定 — rawQuery を deps に入れると navigate のたびに上書きされる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.q]);

  // ============= debounce =============
  useEffect(() => {
    const t = setTimeout(() => {
      const trimmed = rawQuery.trim();
      setDebouncedQuery(trimmed);
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [rawQuery]);

  // 新クエリで「もっと見る」展開状態を初期化
  useEffect(() => {
    setExpandPosts(false);
    setExpandCommunities(false);
  }, [debouncedQuery]);

  // ============= focus 進捗 (Inkline 下線 / Masthead 畳み を駆動する SharedValue) =============
  const focusProgress = useSharedValue(0);
  useEffect(() => {
    focusProgress.value = withTiming(inputFocused ? 1 : 0, { duration: 220 });
  }, [inputFocused, focusProgress]);

  // ============= 検索クエリ実行 (v4) =============
  const showResults = debouncedQuery.length > 0;

  // 検索 personalization 設定 — diversify_results を v4 に渡す
  const { preferences } = useSearchPreferences();

  // 投稿検索 — useSearchV4 (多 signal ランキング + intent + diversify)
  const searchV4 = useSearchV4({
    query: debouncedQuery,
    limit: 30,
    offset: 0,
    community_id: communityId,
    use_diversify: preferences.diversify_results,
  });

  // 検索ヒット post の本体を 1 RTT で取りに行く
  // (useSearchV4 は post_id + final_score + signal breakdown だけ返すため)
  const postIds = useMemo(
    () => (searchV4.data ?? []).map((r) => r.post_id),
    [searchV4.data],
  );

  const postsQuery = useQuery<Post[]>({
    queryKey: ['searchV4-posts', postIds.join('|')],
    queryFn: async () => {
      if (postIds.length === 0) return [];
      // 投稿ごとに 1 RTT を許容 — useSearchV4 の上位 N (= 30) に絞っているので
      // 並列で問題ないが、Promise.allSettled で 1 件失敗が全体を壊さないようにする
      const settled = await Promise.allSettled(postIds.map((id) => fetchPostById(id)));
      return settled
        .map((r) => (r.status === 'fulfilled' ? r.value : null))
        .filter((p): p is Post => p !== null);
    },
    enabled: postIds.length > 0,
    staleTime: 60_000,
  });

  // ============= クエリ意図 (intent display) =============
  const intentQuery = useQueryIntent(debouncedQuery);
  // confidence 降順 top1 のみ表示 (server 側で order by 済み想定だが念のため再 sort)
  const topIntent = useMemo(() => {
    const list = intentQuery.data ?? [];
    if (list.length === 0) return null;
    const sorted = [...list].sort((a, b) => b.confidence - a.confidence);
    const head = sorted[0];
    if (!head) return null;
    // 'general' は無意味な fallback なので非表示
    if (head.intent === 'general') return null;
    return head;
  }, [intentQuery.data]);

  // ============= engagement ログ (impression / click / dwell) =============
  const logEngagement = useLogSearchEngagement();

  // 結果到着後、可視範囲の post に対し impression を一括 log
  // (PREVIEW_LIMIT 内 = ユーザーが最初に目にする可能性が高い行)
  const impressionFiredRef = useRef<Set<string>>(new Set());
  // 新 query になったら impression 記録セットをリセット
  useEffect(() => {
    impressionFiredRef.current = new Set();
  }, [debouncedQuery]);

  useEffect(() => {
    if (!showResults) return;
    const rows = searchV4.data ?? [];
    if (rows.length === 0) return;
    // category=posts なら全件、それ以外は preview 範囲のみ
    const visibleCount = category === 'posts' || expandPosts
      ? rows.length
      : Math.min(rows.length, PREVIEW_LIMIT);
    for (let i = 0; i < visibleCount; i += 1) {
      const r = rows[i];
      if (!r) continue;
      const dedupeKey = `${debouncedQuery}::${r.post_id}::${i + 1}`;
      if (impressionFiredRef.current.has(dedupeKey)) continue;
      impressionFiredRef.current.add(dedupeKey);
      logEngagement.mutate({
        query: debouncedQuery,
        post_id: r.post_id,
        position: i + 1,
        action: 'impression',
      });
    }
    // logEngagement は stable な mutation 参照のため deps から外す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchV4.data, debouncedQuery, showResults, category, expandPosts]);

  // ============= dwell 計測 (post 詳細 navigate -> 戻り) =============
  // navigate 直前に start を記録し、focus が戻ったら経過 ms を server に送る。
  // ref で保持して、画面再描画では消えないようにする。
  const dwellRef = useRef<{
    postId: string;
    query: string;
    position: number;
    startedAt: number;
  } | null>(null);

  useFocusEffect(
    useCallback(() => {
      // focus 戻り時に未送信 dwell があれば送る
      return () => {
        // cleanup (= unfocus 時) ではなく、focus 時に判定したい — useFocusEffect は
        // setup 関数が focus 時に呼ばれるので、ここに来た瞬間に「直前まで unfocus」だった
        // ことを意味する。ただし初回 mount でも呼ばれるので dwellRef が null なら no-op。
      };
    }, []),
  );

  useFocusEffect(
    useCallback(() => {
      const pending = dwellRef.current;
      if (pending) {
        const dwellMs = Date.now() - pending.startedAt;
        // 100ms 未満は誤タップ判定で送らない (server で弾かれるが事前 cap)
        if (dwellMs >= 100) {
          logEngagement.mutate({
            query: pending.query,
            post_id: pending.postId,
            position: pending.position,
            action: 'dwell',
            dwell_ms: dwellMs,
          });
        }
        dwellRef.current = null;
      }
      return undefined;
      // logEngagement は stable
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  /**
   * 検索結果カードがタップされたときに呼ぶ。
   *  - click event を server に送る
   *  - dwellRef を「navigate 直前」として記録
   *  - signal 記録 (signals store) と router.push は呼び出し側で同期実行
   */
  const recordClickAndDwellStart = useCallback(
    (postId: string, position: number) => {
      logEngagement.mutate({
        query: debouncedQuery,
        post_id: postId,
        position,
        action: 'click',
      });
      dwellRef.current = {
        postId,
        query: debouncedQuery,
        position,
        startedAt: Date.now(),
      };
    },
    [debouncedQuery, logEngagement],
  );

  // コミュニティ検索 — searchCommunities (既存 lib/api/communities.ts)
  const communitiesQuery = useQuery<CommunityHit[]>({
    queryKey: ['search-communities', debouncedQuery],
    queryFn: () => searchCommunities({ query: debouncedQuery, limit: 20 }),
    enabled: showResults,
    staleTime: 60_000,
  });

  // ============= "もしかして..." (typo 補正) =============
  const trending = useTrendingTopics(24, 12);
  const trendingNames = useMemo(
    () => (trending.data ?? []).map((t) => t.topic),
    [trending.data],
  );

  const didYouMean = useMemo<string | null>(() => {
    if (!showResults) return null;
    const noResults = (postsQuery.data?.length ?? 0) === 0
      && (communitiesQuery.data?.length ?? 0) === 0
      && !postsQuery.isLoading
      && !communitiesQuery.isLoading;
    if (!noResults) return null;
    if (debouncedQuery.length < 2) return null;
    const corpus = trendingNames.length > 0 ? trendingNames : [];
    if (corpus.length === 0) return null;
    return findClosest(debouncedQuery, corpus, 0.55);
  }, [showResults, postsQuery.data, postsQuery.isLoading, communitiesQuery.data, communitiesQuery.isLoading, debouncedQuery, trendingNames]);

  // ============= ハイライト用 terms =============
  const highlightTerms = useMemo(
    () => debouncedQuery.split(/\s+/).filter((s) => s.length > 0),
    [debouncedQuery],
  );

  // ============= 検索 commit (Enter / 履歴タップ / 候補タップ) =============
  const commit = useCallback((override?: string) => {
    const next = (override ?? rawQuery).trim();
    if (!next) return;
    if (next !== rawQuery) setRawQuery(next);
    if (next !== debouncedQuery) setDebouncedQuery(next);
    pickQuery(next);
    Keyboard.dismiss();
  }, [rawQuery, debouncedQuery, pickQuery]);

  const clearInput = useCallback(() => {
    setRawQuery('');
    setDebouncedQuery('');
    inputRef.current?.focus();
  }, []);

  // ============= pull-to-refresh =============
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (showResults) {
        await Promise.allSettled([
          searchV4.refetch(),
          postsQuery.refetch(),
          communitiesQuery.refetch(),
        ]);
      } else {
        // Discovery 全 section の query を invalidate
        await Promise.allSettled([
          qc.invalidateQueries({ queryKey: ['hot-posts-row'] }),
          qc.invalidateQueries({ queryKey: ['discover-recommended'] }),
          qc.invalidateQueries({ queryKey: ['discover-rising'] }),
          qc.invalidateQueries({ queryKey: ['discover-official'] }),
          qc.invalidateQueries({ queryKey: ['for-you-shelf'] }),
          qc.invalidateQueries({ queryKey: ['trendingTopics'] }),
          qc.invalidateQueries({ queryKey: ['trending-tags'] }),
        ]);
      }
    } finally {
      setRefreshing(false);
    }
  }, [showResults, searchV4, postsQuery, communitiesQuery, qc]);

  // ============= 派生 =============
  const posts = postsQuery.data ?? [];
  const communities = communitiesQuery.data ?? [];
  const totalCount = posts.length + communities.length;
  const isLoading = (searchV4.isLoading || postsQuery.isLoading || communitiesQuery.isLoading)
    && !refreshing;

  // 結果 0 件 (loading 終了後)
  const isEmpty = showResults
    && !isLoading
    && totalCount === 0;

  // ============= history を表示するか? (input focus + empty + 履歴あり) =============
  const showHistory = inputFocused && rawQuery.length === 0 && history.length > 0;

  // ============= EDITORIAL: 派生 UI 値 =============
  // typing = 入力はあるが debounce 未着地 (Inkline の往復ハイライト判定)
  const isTyping = rawQuery.trim().length > 0 && rawQuery.trim() !== debouncedQuery;
  // 検索バー右肩の件数 (結果表示中のみ)
  const resultCount = showResults ? totalCount : null;
  // 発行メタ (マストヘッド右下)
  const volText = useMemo(() => {
    const now = new Date();
    return `VOL.${getISOWeek(now)} ／ ${now.getMonth() + 1}月${now.getDate()}日`;
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* ============= sticky ヘッダ (Inkline 検索バー) ============= */}
      <View
        style={{
          paddingTop: insets.top + SP['2'],
          paddingBottom: SP['2'],
          backgroundColor: C.bg,
          // sticky な見え方 (z-index で history dropdown を被せる)
          zIndex: 10,
        }}
      >
        <InklineSearchBar
          value={rawQuery}
          onChangeText={setRawQuery}
          onSubmit={() => commit()}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
          onClear={clearInput}
          focusProgress={focusProgress}
          resultCount={resultCount}
          isTyping={isTyping}
          inputRef={inputRef}
        />

        {/* ============= 履歴 dropdown (focus + empty) ============= */}
        {showHistory && (
          <View
            style={{
              marginTop: SP['2'],
              marginHorizontal: SP['5'],
              backgroundColor: C.bg2,
              borderRadius: R.lg,
              borderWidth: 1,
              borderColor: C.border,
              overflow: 'hidden',
            }}
          >
            {/* header — 「最近の検索」 + 「すべて消去」 */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingHorizontal: SP['3'],
                paddingVertical: SP['2'],
                borderBottomWidth: 1,
                borderBottomColor: C.divider,
              }}
            >
              <Text style={[T.captionM, { color: C.text3, letterSpacing: 0.5 }]}>
                最近の検索
              </Text>
              <PressableScale
                onPress={() => {
                  clearAll();
                }}
                haptic="warn"
                hitSlop={6}
                accessibilityLabel="検索履歴をすべて消去"
                accessibilityRole="button"
              >
                <Text style={[T.caption, { color: C.accentLight, fontWeight: '700' }]}>
                  すべて消去
                </Text>
              </PressableScale>
            </View>

            {/* rows */}
            {history.slice(0, 10).map((h, idx) => {
              const isLast = idx === Math.min(history.length, 10) - 1;
              return (
                <View
                  key={`hist-${h}`}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    borderBottomWidth: isLast ? 0 : 1,
                    borderBottomColor: C.divider,
                  }}
                >
                  <PressableScale
                    onPress={() => commit(h)}
                    haptic="select"
                    accessibilityLabel={`${h} で再検索`}
                    accessibilityRole="button"
                    style={{
                      flex: 1,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: SP['2'],
                      paddingHorizontal: SP['3'],
                      paddingVertical: SP['3'],
                    }}
                  >
                    <Icon.clock size={16} color={C.text3} strokeWidth={2} />
                    <Text style={[T.body, { color: C.text, flex: 1 }]} numberOfLines={1}>
                      {h}
                    </Text>
                  </PressableScale>
                  <PressableScale
                    onPress={() => removeQuery(h)}
                    haptic="warn"
                    hitSlop={8}
                    accessibilityLabel={`${h} を履歴から削除`}
                    accessibilityRole="button"
                    style={{
                      paddingHorizontal: SP['3'],
                      paddingVertical: SP['3'],
                    }}
                  >
                    <Icon.close size={14} color={C.text3} strokeWidth={2.2} />
                  </PressableScale>
                </View>
              );
            })}
          </View>
        )}

        {/* ============= intent 表示 (結果あり時のみ、控えめに) ============= */}
        {showResults && !showHistory && topIntent && (
          <View
            style={{
              marginTop: SP['2'],
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: SP['5'],
            }}
            accessibilityLabel={`検索意図: ${topIntent.intent}`}
          >
            <Icon.sparkles size={11} color={C.text3} strokeWidth={2.2} />
            <Text style={[T.caption, { color: C.text3, letterSpacing: 0.3 }]}>
              intent: {topIntent.intent}
            </Text>
          </View>
        )}

        {/* ============= community filter chip (URL ?community=<id>) ============= */}
        {showResults && !showHistory && communityId && (
          <View
            style={{
              marginTop: SP['2'],
              marginHorizontal: SP['5'],
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: SP['2'],
              paddingVertical: 5,
              backgroundColor: C.accentBg,
              borderRadius: R.full,
              borderWidth: 1,
              borderColor: C.accent + '55',
              alignSelf: 'flex-start',
            }}
            accessibilityLabel={`コミュニティ内検索: ${communityId}`}
          >
            <Icon.community size={11} color={C.accentLight} strokeWidth={2.2} />
            <Text style={[T.caption, { color: C.accentLight, fontWeight: '700' }]}>
              このコミュニティ内
            </Text>
          </View>
        )}

        {/* ============= カテゴリ ランニングヘッド (結果あり時のみ) ============= */}
        {showResults && !showHistory && (
          <View style={{ marginTop: SP['2'] }}>
            <CategoryRunningHead
              tabs={[
                { key: 'all', label: 'すべて', count: totalCount },
                { key: 'posts', label: '投稿', count: posts.length },
                { key: 'communities', label: 'コミュニティ', count: communities.length },
              ]}
              category={category}
              onChange={setCategory}
            />
          </View>
        )}
      </View>

      {/* ============= スクロール本体 ============= */}
      <ScrollView
        contentContainerStyle={{
          paddingTop: SP['2'],
          paddingBottom: insets.bottom + SP['10'],
          gap: SP['4'],
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.accent}
            colors={[C.accent]}
            progressBackgroundColor={C.bg2}
          />
        }
      >
        {!showResults ? (
          <>
            {/* 署名マストヘッド — フォーカスで畳まれる */}
            <EditorialMasthead focusProgress={focusProgress} volText={volText} />
            <DiscoveryView />
          </>
        ) : isLoading && totalCount === 0 ? (
          // 組版中スケルトン (実カード同寸 + 水平シマー)
          <EditorialSkeleton />
        ) : isEmpty ? (
          <EditorialEmpty
            query={debouncedQuery}
            didYouMean={didYouMean}
            onPickSuggestion={(s) => commit(s)}
            onClear={clearInput}
            onBrowse={() => {
              clearInput();
              Keyboard.dismiss();
            }}
          />
        ) : (
          <View style={{ paddingHorizontal: SP['5'] }}>
            {/* ============= 投稿セクション ============= */}
            {(category === 'all' || category === 'posts') && posts.length > 0 && (
              <ResultSection
                title="投稿"
                icon="post"
                total={posts.length}
                expanded={expandPosts || category === 'posts'}
                limit={category === 'all' ? PREVIEW_LIMIT : posts.length}
                onExpand={() => {
                  setExpandPosts(true);
                  setCategory('posts');
                }}
              >
                {(category === 'all' && !expandPosts
                  ? posts.slice(0, PREVIEW_LIMIT)
                  : posts
                ).map((p, idx) => (
                  <EditorialPostCard
                    key={p.id}
                    post={p}
                    rank={idx + 1}
                    terms={highlightTerms}
                    onPress={() => {
                      // 1-based position を server に送る (hookpoint 温存)
                      recordClickAndDwellStart(p.id, idx + 1);
                      recordSignal({ kind: 'post', id: p.id, tags: p.tag_names });
                      router.push(`/post/${p.id}` as never);
                    }}
                    onExplain={() => {
                      setExplainPost({ id: p.id, query: debouncedQuery });
                    }}
                  />
                ))}
              </ResultSection>
            )}

            {/* ============= コミュニティセクション ============= */}
            {(category === 'all' || category === 'communities') && communities.length > 0 && (
              <ResultSection
                title="コミュニティ"
                icon="community"
                total={communities.length}
                expanded={expandCommunities || category === 'communities'}
                limit={category === 'all' ? PREVIEW_LIMIT : communities.length}
                onExpand={() => {
                  setExpandCommunities(true);
                  setCategory('communities');
                }}
              >
                {(category === 'all' && !expandCommunities
                  ? communities.slice(0, PREVIEW_LIMIT)
                  : communities
                ).map((c, idx) => (
                  <EditorialCommunityRow
                    key={c.id}
                    community={c}
                    rank={idx + 1}
                    terms={highlightTerms}
                    onPress={() => {
                      router.push(`/community/${c.id}` as never);
                    }}
                  />
                ))}
              </ResultSection>
            )}
          </View>
        )}
      </ScrollView>

      {/* ============= 「なぜこの結果?」 modal =============
          RankingExplainer は別 agent が並列で実装中の C5 component。
          open / post_id / query / onClose を最低限 props として受ける想定。
          modal 内部で useResultExplanation を呼んで factor breakdown を描画する。 */}
      <RankingExplainer
        visible={explainPost !== null}
        postId={explainPost?.id ?? ''}
        query={explainPost?.query ?? ''}
        onClose={() => setExplainPost(null)}
      />
    </View>
  );
}

// ============================================================
// DiscoveryView — query 空時の "探す" 体験
// ------------------------------------------------------------
// 各 row は内側で paddingHorizontal: SP['4'] を持つ前提で並べる
// (= 親 ScrollView は左右 padding を持たない)。
// ============================================================
function DiscoveryView() {
  // メンバーシップ判定 (参加済みか) — 3 shelf 共通で使い回す
  const { idSet: memberIdSet } = useMyCommunityIds();
  // 参加ボタン / カードタップの共通ハンドラ
  //   - open      → その場で join_community + 楽観表示 + invalidate
  //   - request/invite → 詳細画面へ遷移 (申請フローはそこに居る)
  //   - 二重タップは joiningIds の Set で O(1) ガード
  const { joiningIds, onJoin, onPressCommunity } = useJoinCommunity();

  // おすすめ — query 無し discoverCommunities = 人気順 (member_count desc)
  const recommended = useQuery({
    queryKey: ['discover-recommended'],
    queryFn: () => discoverCommunities({ limit: 8 }),
    staleTime: 60_000,
  });

  // 急上昇 — last_post_at の新しい順 (最近投稿が活発)
  const rising = useQuery({
    queryKey: ['discover-rising'],
    queryFn: () => fetchRisingCommunities(10),
    staleTime: 60_000,
  });

  // 公式 — is_official のみ (member_count desc)
  const official = useQuery({
    queryKey: ['discover-official'],
    queryFn: () => fetchOfficialCommunities(10),
    staleTime: 60_000,
  });

  return (
    <View style={{ gap: SP['5'] }}>
      {/* 1) Trending — topic chip 行 (server-side acceleration) */}
      <TrendingTopicsRow />

      {/* 2) 今日のホット — 横スクロールカード (動画サムネ対応) */}
      <HotPostsRow />

      {/* 3) あなたへのおすすめ — パーソナライズ (未ログインで non-render) */}
      <ForYouShelf />

      {/* 4) おすすめコミュニティ — 人気順の大カード */}
      <CommunityShelf
        title="おすすめ"
        iconName="sparkles"
        communities={recommended.data ?? []}
        memberIdSet={memberIdSet}
        joiningIds={joiningIds}
        onJoin={onJoin}
        onPressCommunity={onPressCommunity}
        isLoading={recommended.isLoading}
        emptyText="まだコミュニティがありません"
      />

      {/* 5) 急上昇 — 最近の投稿で勢いのあるコミュ */}
      <CommunityShelf
        title="急上昇"
        iconName="trendingUp"
        communities={rising.data ?? []}
        memberIdSet={memberIdSet}
        joiningIds={joiningIds}
        onJoin={onJoin}
        onPressCommunity={onPressCommunity}
        isLoading={rising.isLoading}
        emptyText="まだ急上昇コミュニティがありません"
      />

      {/* 6) 公式 — 運営/ブランド公式コミュ */}
      <CommunityShelf
        title="公式"
        iconName="award"
        communities={official.data ?? []}
        memberIdSet={memberIdSet}
        joiningIds={joiningIds}
        onJoin={onJoin}
        onPressCommunity={onPressCommunity}
        isLoading={official.isLoading}
        emptyText="公式コミュニティはまだありません"
      />

      {/* 7) ジャンル別 */}
      <InterestCategories />
    </View>
  );
}

// ============================================================
// TrendingTopicsRow — useTrendingTopics で server-side ランキング
// ------------------------------------------------------------
// 旧 TrendingRow は acceleration ベースの tag ランキング (lib/api/trending.ts)。
// 本 row は v2 (server BM25 + recency window) の topic を chip 列で表示。
// search 画面に「今 Geek で何が話題か」を一目で見せる入口になる。
// ============================================================
function TrendingTopicsRow() {
  const router = useRouter();
  const { data: topics } = useTrendingTopics(24, 12);
  const items = topics ?? [];
  if (items.length === 0) return null;

  return (
    <View style={{ gap: SP['2'] }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: SP['4'],
        }}
      >
        <Icon.sparkles size={14} color={C.text3} strokeWidth={2.2} />
        <Text style={[T.smallM, { color: C.text3, letterSpacing: 0.5 }]}>
          いまのトレンド
        </Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          gap: 6,
          paddingHorizontal: SP['4'],
        }}
      >
        {items.map((t, i) => (
          <PressableScale
            key={t.topic}
            onPress={() => router.push(`/search?q=${encodeURIComponent(t.topic)}` as never)}
            haptic="tap"
            accessibilityLabel={`トレンドで検索: ${t.topic}`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: SP['3'],
              paddingVertical: SP['2'],
              backgroundColor: i === 0 ? 'rgba(255,140,48,0.18)' : C.bg2,
              borderRadius: R.full,
              borderWidth: 1,
              borderColor: i === 0 ? 'rgba(255,140,48,0.5)' : C.border,
            }}
          >
            <Text
              style={[
                T.smallM,
                { color: i === 0 ? '#FF8C30' : C.text, fontWeight: '700' },
              ]}
            >
              {t.topic.startsWith('#') ? t.topic : `#${t.topic}`}
            </Text>
            <View
              style={{
                paddingHorizontal: 5,
                paddingVertical: 1,
                backgroundColor: i === 0 ? 'rgba(255,140,48,0.3)' : C.bg3,
                borderRadius: R.sm,
              }}
            >
              <Text
                style={{
                  fontSize: 10,
                  color: i === 0 ? '#FF8C30' : C.text3,
                  fontWeight: '700',
                }}
              >
                +{t.post_count}
              </Text>
            </View>
          </PressableScale>
        ))}
      </ScrollView>
    </View>
  );
}

// ============================================================
// ResultSection — 検索結果のセクションフレーム
// ------------------------------------------------------------
// SF Pro semibold 17pt 相当のヘッダー (T.h4 = 16 / 700 を流用)。
// preview limit を超えたら「もっと見る (+N)」を下に出す。
// ============================================================
function ResultSection({
  title,
  icon,
  total,
  limit,
  expanded,
  onExpand,
  children,
}: {
  title: string;
  icon: 'post' | 'community';
  total: number;
  limit: number;
  expanded: boolean;
  onExpand: () => void;
  children: React.ReactNode;
}) {
  const IconC = icon === 'post' ? Icon.post : Icon.community;
  const remaining = total - limit;
  const showMore = !expanded && total > limit;

  return (
    <View style={{ gap: SP['2'] }}>
      {/* SF Pro semibold 17pt 相当のヘッダー */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <IconC size={16} color={C.text2} strokeWidth={2.2} />
          <Text style={[T.h4, { color: C.text }]}>{title}</Text>
          <View
            style={{
              paddingHorizontal: 6,
              paddingVertical: 1,
              backgroundColor: C.bg3,
              borderRadius: R.sm,
            }}
          >
            <Text style={{ fontSize: 10, color: C.text3, fontWeight: '700' }}>
              {total}
            </Text>
          </View>
        </View>
      </View>
      <View style={{ gap: SP['2'] }}>{children}</View>
      {showMore && (
        <PressableScale
          onPress={onExpand}
          haptic="tap"
          accessibilityRole="button"
          accessibilityLabel={`${title}をもっと見る`}
          style={{
            marginTop: SP['1'],
            paddingVertical: 10,
            paddingHorizontal: SP['3'],
            backgroundColor: C.bg2,
            borderRadius: R.md,
            borderWidth: 1,
            borderColor: C.accent + '40',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
          }}
        >
          <Text style={[T.smallM, { color: C.accentLight, fontWeight: '700' }]}>
            {title}をもっと見る (+{remaining})
          </Text>
          <Icon.chevronR size={14} color={C.accentLight} strokeWidth={2.2} />
        </PressableScale>
      )}
    </View>
  );
}
