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
  ActivityIndicator,
  TextInput,
  RefreshControl,
  Keyboard,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  interpolateColor,
} from 'react-native-reanimated';
import { Image as ExpoImage } from 'expo-image';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TopBar } from '../../components/nav/TopBar';
import { PressableScale } from '../../components/ui/PressableScale';
import { HighlightedText } from '../../components/ui/HighlightedText';
import { Avatar } from '../../components/ui/Avatar';
import { Icon } from '../../constants/icons';
import { C, R, SHADOW, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { TIMING_FAST } from '../../design/motion';
import { formatRelative } from '../../lib/utils/date';
import { fetchPostById } from '../../lib/api/posts';
import { searchCommunities, type CommunityHit } from '../../lib/api/communities';
import { useSearchHistory } from '../../hooks/useSearchHistory';
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
import { RecommendedCommunities } from '../../components/search/RecommendedCommunities';
import { InterestCategories } from '../../components/search/InterestCategories';
import { ForYouShelf } from '../../components/search/ForYouShelf';
import { RankingExplainer } from '@/components/search/RankingExplainer';

// 検索 input の debounce — typing 中の不要な fetch を抑える
const DEBOUNCE_MS = 200;
// 結果セクションあたりの初期表示件数 (「もっと見る」で展開)
const PREVIEW_LIMIT = 5;

type ResultCategory = 'all' | 'posts' | 'communities';

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

  // ============= focus 時 animated border (iOS-native) =============
  const focusProgress = useSharedValue(0);
  useEffect(() => {
    focusProgress.value = withTiming(inputFocused ? 1 : 0, TIMING_FAST);
  }, [inputFocused, focusProgress]);

  const aSearchBorder = useAnimatedStyle(() => ({
    borderColor: interpolateColor(
      focusProgress.value,
      [0, 1],
      ['rgba(255,255,255,0.08)', C.accent + 'CC'],
    ),
  }));

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
          qc.invalidateQueries({ queryKey: ['recommended-communities'] }),
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

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="検索" />

      {/* ============= sticky 検索 input ============= */}
      <View
        style={{
          paddingHorizontal: SP['4'],
          paddingTop: SP['2'],
          paddingBottom: SP['2'],
          backgroundColor: C.bg,
          // sticky な見え方 (z-index で history dropdown を被せる)
          zIndex: 10,
        }}
      >
        <Animated.View
          style={[
            {
              flexDirection: 'row',
              alignItems: 'center',
              gap: SP['2'],
              paddingHorizontal: 12,
              paddingVertical: 10,
              backgroundColor: C.bg2,
              // iOS-native 検索バー風 — pill ではなく radius 12 の rounded rect
              borderRadius: 12,
              borderWidth: 1,
            },
            aSearchBorder,
            inputFocused ? SHADOW.sm : SHADOW.xs,
          ]}
        >
          <Icon.search
            size={18}
            color={inputFocused ? C.accentLight : C.text3}
            strokeWidth={2.2}
          />
          <TextInput
            ref={inputRef}
            value={rawQuery}
            onChangeText={setRawQuery}
            placeholder="Geek 内を検索"
            placeholderTextColor={C.text3}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            onSubmitEditing={() => commit()}
            returnKeyType="search"
            blurOnSubmit
            autoCorrect={false}
            autoCapitalize="none"
            keyboardAppearance="dark"
            selectionColor={C.accent}
            cursorColor={C.accent}
            accessibilityLabel="検索キーワード入力"
            // memory DoS 対策
            maxLength={200}
            style={[T.body, { flex: 1, color: C.text, paddingVertical: 0 }]}
          />

          {/* right side: clear (× when typing) / voice icon (placeholder) */}
          {rawQuery.length > 0 ? (
            <PressableScale
              onPress={clearInput}
              haptic="tap"
              hitSlop={10}
              accessibilityLabel="入力をクリア"
              accessibilityRole="button"
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: C.bg4,
              }}
            >
              <Icon.close size={13} color={C.text2} strokeWidth={2.4} />
            </PressableScale>
          ) : (
            // Voice icon — placeholder のみ (tap 無効)
            <View
              accessibilityElementsHidden
              importantForAccessibility="no"
              style={{
                width: 22,
                height: 22,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: 0.45,
              }}
            >
              <Icon.phone size={16} color={C.text3} strokeWidth={2} />
            </View>
          )}
        </Animated.View>

        {/* ============= 履歴 dropdown (focus + empty) ============= */}
        {showHistory && (
          <View
            style={[
              {
                marginTop: SP['2'],
                backgroundColor: C.bg2,
                borderRadius: R.lg,
                borderWidth: 1,
                borderColor: C.border,
                overflow: 'hidden',
              },
              SHADOW.md,
            ]}
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
              paddingHorizontal: 2,
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

        {/* ============= カテゴリタブ (結果あり時のみ) ============= */}
        {showResults && !showHistory && (
          <View style={{ marginTop: SP['2'] }}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {(['all', 'posts', 'communities'] as ResultCategory[]).map((c) => {
                  const active = category === c;
                  const label = c === 'all' ? 'すべて' : c === 'posts' ? '投稿' : 'コミュニティ';
                  const count = c === 'posts' ? posts.length
                    : c === 'communities' ? communities.length
                    : totalCount;
                  return (
                    <PressableScale
                      key={c}
                      onPress={() => setCategory(c)}
                      haptic="select"
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                        paddingHorizontal: SP['3'],
                        paddingVertical: 7,
                        backgroundColor: active ? C.accentBg : C.bg2,
                        borderRadius: R.full,
                        borderWidth: 1,
                        borderColor: active ? C.accent : C.border,
                      }}
                    >
                      <Text
                        style={[
                          T.smallM,
                          {
                            color: active ? C.accentLight : C.text,
                            fontWeight: '700',
                          },
                        ]}
                      >
                        {label}
                      </Text>
                      <View
                        style={{
                          paddingHorizontal: 5,
                          paddingVertical: 1,
                          backgroundColor: active ? C.accent : C.bg4,
                          borderRadius: R.sm,
                          minWidth: 18,
                          alignItems: 'center',
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 9,
                            color: active ? '#fff' : C.text3,
                            fontWeight: '700',
                          }}
                        >
                          {count}
                        </Text>
                      </View>
                    </PressableScale>
                  );
                })}
              </View>
            </ScrollView>
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
          <DiscoveryView />
        ) : isLoading && totalCount === 0 ? (
          <View style={{ paddingVertical: SP['10'], alignItems: 'center' }}>
            <ActivityIndicator color={C.accent} />
          </View>
        ) : isEmpty ? (
          <EmptyResultsView
            query={debouncedQuery}
            didYouMean={didYouMean}
            onPickSuggestion={(s) => commit(s)}
            onClear={clearInput}
          />
        ) : (
          <View style={{ paddingHorizontal: SP['4'], gap: SP['4'] }}>
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
                  <CompactPostCard
                    key={p.id}
                    post={p}
                    highlightTerms={highlightTerms}
                    onPress={() => {
                      // 1-based position を server に送る
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
                ).map((c) => (
                  <CompactCommunityCard
                    key={c.id}
                    community={c}
                    highlightTerms={highlightTerms}
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
  return (
    <View style={{ gap: SP['5'] }}>
      {/* 1) Trending — topic chip 行 (server-side acceleration) */}
      <TrendingTopicsRow />

      {/* 2) 今日のホット — 横スクロールカード */}
      <HotPostsRow />

      {/* 3) あなたへのおすすめ — パーソナライズ (未ログインで non-render) */}
      <ForYouShelf />

      {/* 4) コミュニティを探す */}
      <RecommendedCommunities />

      {/* 5) ジャンル別 */}
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

// ============================================================
// CompactPostCard — 検索結果用の小型投稿カード
// ------------------------------------------------------------
// AnonPostCard はリアクション / メディア / コメントなどを全部抱えていて重い。
// 検索結果は「何の話か」一目で分かれば良いので、title + content 抜粋 + meta
// だけのコンパクト版にする。
// ============================================================
function CompactPostCard({
  post,
  highlightTerms,
  onPress,
  onExplain,
}: {
  post: Post;
  highlightTerms: string[];
  onPress: () => void;
  /** ⓘ「なぜこの結果?」アイコンをタップしたとき */
  onExplain: () => void;
}) {
  // タイトル (title フィールド or content 1 行目)
  const title = useMemo(() => {
    if (post.title && post.title.trim().length > 0) return post.title;
    const firstLine = (post.content ?? '').split('\n')[0]?.trim() ?? '';
    return firstLine.length > 0 ? firstLine : null;
  }, [post.title, post.content]);

  // 本文プレビュー (title と重複しないように)
  const preview = useMemo(() => {
    const content = (post.content ?? '').trim();
    if (!content) return '';
    if (post.title) return content.slice(0, 160);
    // title が content の 1 行目から来ているなら、2 行目以降を出す
    const rest = content.split('\n').slice(1).join(' ').trim();
    return rest.length > 0 ? rest.slice(0, 160) : '';
  }, [post.title, post.content]);

  // 画像 thumbnail — media_urls[0] があれば横長 row の左側に小さく表示。
  // 拡大せず objectFit cover で中央 crop (情報密度を保つ)。
  // 動画/blurhash は AnonPostCard の重い経路に任せ、検索結果は静止画 URL のみ。
  const thumbUrl = useMemo(() => {
    const urls = post.media_urls;
    if (!Array.isArray(urls) || urls.length === 0) return null;
    const first = urls[0];
    if (typeof first !== 'string' || first.length === 0) return null;
    // ローカル URI が混ざることはない契約 (createPost で弾く) だが念のため http(s) のみ通す
    if (!/^https?:\/\//i.test(first)) return null;
    return first;
  }, [post.media_urls]);

  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      accessibilityRole="button"
      accessibilityLabel={`投稿を開く: ${title ?? ''}`}
      style={{
        padding: SP['3'],
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
        gap: SP['2'],
      }}
    >
      {/* meta — 匿名 + 相対時刻 + 反応カウント + 「なぜこの結果?」 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
        <Avatar size={20} anonymous />
        <Text style={[T.caption, { color: C.text3, flex: 1 }]} numberOfLines={1}>
          匿名 · {formatRelative(post.created_at)}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Icon.heart size={11} color={C.text3} strokeWidth={2} />
          <Text style={[T.caption, { color: C.text3, fontWeight: '700' }]}>
            {post.likes_count.toLocaleString('ja-JP')}
          </Text>
          <Icon.comment size={11} color={C.text3} strokeWidth={2} />
          <Text style={[T.caption, { color: C.text3, fontWeight: '700' }]}>
            {post.comments_count.toLocaleString('ja-JP')}
          </Text>
        </View>
        {/* ⓘ「なぜこの結果?」 — RankingExplainer modal を開く
            React Native の Pressable は default で親へイベント伝播しない
            (capture/bubble は SyntheticEvent 経路を取らない) ため、
            stopPropagation は不要 — 子の onPress は親の onPress を
            発火させない。 */}
        <PressableScale
          onPress={onExplain}
          haptic="tap"
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="この結果が出た理由を見る"
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: C.bg3,
          }}
        >
          <Icon.info size={12} color={C.text3} strokeWidth={2.2} />
        </PressableScale>
      </View>

      {/* 本文ブロック — 画像があれば horizontal layout (image left, text right)、
          無ければ素の縦並び。iOS-native な「Mail の添付プレビュー」感を狙う。 */}
      <View
        style={{
          flexDirection: thumbUrl ? 'row' : 'column',
          alignItems: thumbUrl ? 'flex-start' : 'stretch',
          gap: thumbUrl ? SP['3'] : SP['2'],
        }}
      >
        {thumbUrl && (
          <ExpoImage
            source={{ uri: thumbUrl }}
            style={{
              width: 72,
              height: 72,
              borderRadius: 10,
              backgroundColor: C.bg3,
            }}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={120}
            recyclingKey={post.id}
            accessibilityIgnoresInvertColors
          />
        )}
        <View style={{ flex: 1, gap: SP['2'] }}>
          {/* title — 大きく */}
          {title && (
            <HighlightedText
              text={title}
              terms={highlightTerms}
              style={[T.bodyB, { color: C.text }]}
              numberOfLines={2}
            />
          )}

          {/* 本文 preview */}
          {preview.length > 0 && (
            <HighlightedText
              text={preview}
              terms={highlightTerms}
              style={[T.small, { color: C.text2 }]}
              numberOfLines={2}
            />
          )}

          {/* tag chips (上位 3 件まで) */}
          {post.tag_names && post.tag_names.length > 0 && (
            <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap' }}>
              {Array.from(new Set(post.tag_names)).slice(0, 3).map((tg) => (
                <Text
                  key={tg}
                  style={[T.caption, { color: C.accent, fontWeight: '700' }]}
                >
                  #{tg}
                </Text>
              ))}
            </View>
          )}
        </View>
      </View>
    </PressableScale>
  );
}

// ============================================================
// CompactCommunityCard — 検索結果用のコミュ行
// ------------------------------------------------------------
// 既存 RecommendedCommunities は 120x140 縦カード (Discovery 用)。
// 検索結果は横長 row のほうが情報密度が高い。
// ============================================================
function CompactCommunityCard({
  community,
  highlightTerms,
  onPress,
}: {
  community: CommunityHit;
  highlightTerms: string[];
  onPress: () => void;
}) {
  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      accessibilityRole="button"
      accessibilityLabel={`コミュニティを開く: ${community.name}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['3'],
        padding: SP['3'],
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
      }}
    >
      {/* icon — 既存 emoji + color stripe を踏襲 */}
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: community.icon_color || C.bg3,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: 22 }}>{community.icon_emoji || '🏷'}</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <HighlightedText
          text={community.name}
          terms={highlightTerms}
          style={[T.bodyB, { color: C.text }]}
          numberOfLines={1}
        />
        {community.description && community.description.length > 0 && (
          <HighlightedText
            text={community.description}
            terms={highlightTerms}
            style={[T.caption, { color: C.text3 }]}
            numberOfLines={1}
          />
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
          <Icon.friends size={11} color={C.text3} strokeWidth={2} />
          <Text style={[T.caption, { color: C.text3, fontWeight: '700' }]}>
            {community.member_count.toLocaleString('ja-JP')} 人
          </Text>
        </View>
      </View>
      <Icon.chevronR size={16} color={C.text3} strokeWidth={2} />
    </PressableScale>
  );
}

// ============================================================
// EmptyResultsView — 結果 0 件
// ------------------------------------------------------------
// - "もしかして..." (synonym 候補)
// - 入力をクリア / トレンドへ
// ============================================================
function EmptyResultsView({
  query,
  didYouMean,
  onPickSuggestion,
  onClear,
}: {
  query: string;
  didYouMean: string | null;
  onPickSuggestion: (q: string) => void;
  onClear: () => void;
}) {
  return (
    <View
      style={{
        paddingHorizontal: SP['4'],
        paddingVertical: SP['6'],
        alignItems: 'center',
        gap: SP['4'],
      }}
    >
      <View
        style={{
          width: 84,
          height: 84,
          borderRadius: 42,
          backgroundColor: C.amberBg,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: C.amber + '40',
        }}
      >
        <Icon.search size={36} color={C.amber} strokeWidth={2} />
      </View>
      <View style={{ alignItems: 'center', gap: SP['2'] }}>
        <Text style={[T.h3, { color: C.text, textAlign: 'center' }]}>
          結果がありません
        </Text>
        <Text
          style={[T.small, { color: C.text3, textAlign: 'center', maxWidth: 320 }]}
        >
          <Text style={{ color: C.accentLight, fontWeight: '700' }}>「{query}」</Text>
          に一致する投稿やコミュニティが見つかりませんでした。
        </Text>
      </View>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: SP['2'],
        }}
      >
        {didYouMean && (
          <PressableScale
            onPress={() => onPickSuggestion(didYouMean)}
            haptic="confirm"
            accessibilityRole="button"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: SP['3'],
              paddingVertical: 8,
              backgroundColor: C.accentBg,
              borderRadius: R.full,
              borderWidth: 1,
              borderColor: C.accent + '66',
            }}
          >
            <Icon.sparkles size={14} color={C.accentLight} strokeWidth={2.2} />
            <Text style={[T.smallM, { color: C.accentLight, fontWeight: '700' }]}>
              「{didYouMean}」で検索
            </Text>
          </PressableScale>
        )}
        <PressableScale
          onPress={onClear}
          haptic="tap"
          accessibilityRole="button"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: SP['3'],
            paddingVertical: 8,
            backgroundColor: C.bg2,
            borderRadius: R.full,
            borderWidth: 1,
            borderColor: C.border,
          }}
        >
          <Icon.close size={14} color={C.text2} strokeWidth={2.2} />
          <Text style={[T.smallM, { color: C.text, fontWeight: '700' }]}>
            検索をクリア
          </Text>
        </PressableScale>
      </View>
    </View>
  );
}

