import { useState, useMemo, useEffect, useRef, useCallback, memo } from 'react';
import { View, Text, ScrollView, TextInput, useWindowDimensions, RefreshControl } from 'react-native';
import { FlashList, type ListRenderItem } from '@shopify/flash-list';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedScrollHandler,
  withTiming,
  withSpring,
  withSequence,
  withRepeat,
  Easing,
} from 'react-native-reanimated';
import { useBBS, useMyCommunityBBS } from '../../hooks/useBBS';
import { useDelayedLoading } from '../../hooks/useDelayedLoading';
import type { BBSThread } from '../../types/models';
import { PressableScale } from '../../components/ui/PressableScale';
import { HighlightedText } from '../../components/ui/HighlightedText';
import { ThreadCardSkeleton } from '../../components/ui/Skeleton';
import { Icon } from '../../constants/icons';
import { C, R, SP, SHADOW, GRAD } from '../../design/tokens';
import { T, FONT } from '../../design/typography';
import { TABBAR } from '../../design/tabbar';
import { SPRING_SNAPPY } from '../../design/motion';
import { useColors } from '../../hooks/useColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { formatRelative } from '../../lib/utils/date';
import { parseQuery } from '../../lib/search/queryParser';
import { generateVariants } from '../../lib/search/variants';
import { deepNormalize } from '../../lib/search/tokenize';
import { findClosestK } from '../../lib/search/typoCorrect';
import { textRelevance } from '../../lib/utils/searchAlgo';
import { useSearchClickStore } from '../../stores/searchClickStore';
import { useT } from '../../hooks/useT';
import { logEvent } from '../../lib/personalize';
import { supabase } from '../../lib/supabase';
import { fetchPostById } from '../../lib/api/posts';
import { fetchComments } from '../../lib/api/comments';

type SortMode = 'recent' | 'popular';
// 掲示板タブのスコープ — LINE のトーク/友だち と同じ感覚で 2 択切替
type Scope = 'community' | 'all';

const CATEGORIES = ['すべて', '雑談', 'アニメ', 'ゲーム', 'マンガ', '音楽', 'アイドル', 'Vtuber', '推し活', 'グルメ', 'コスプレ', 'ニュース'];

const CATEGORY_COLORS: Record<string, string> = {
  '雑談': '#22D3A4', 'アニメ': '#FF6B7A', 'ゲーム': '#7CB1FF',
  'マンガ': '#F472B6', '音楽': '#FCD34D', 'アイドル': '#FF8C30',
  'Vtuber': '#A78BFA', '推し活': '#EC4899', 'グルメ': '#84CC16',
  'コスプレ': '#06B6D4', 'ニュース': '#94A3B8',
};

export default function BBSScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  // 「すべて」スコープ用 — 全 public スレッド
  const allBbs = useBBS();
  // 「コミュニティ」スコープ用 — 自分の参加コミュ横断
  const myBbs = useMyCommunityBBS();
  const qc = useQueryClient();

  // ★ Prefetch-on-press: スレタップ先 (/bbs/{id} → /post/{id} redirect) が実際に読む
  //   cache key を温める。これにより遷移完了時には ['post', id] / ['post-comments', id] が
  //   既にキャッシュ済みで、詳細画面が spinner を出さず即座に内容を描画できる。
  //   key / staleTime は app/post/[id].tsx と完全一致させる (=遷移先が cache hit になる)。
  //   prefetchQuery は staleTime 内なら no-op なので連打しても無駄 fetch しない。
  const prefetchThread = useCallback(
    (threadId: string) => {
      void qc
        .prefetchQuery({
          queryKey: ['post', threadId],
          queryFn: () => fetchPostById(threadId),
          staleTime: 60_000, // app/post/[id].tsx:135 と一致
        })
        .catch(() => {});
      void qc
        .prefetchQuery({
          queryKey: ['post-comments', threadId],
          queryFn: () => fetchComments(threadId),
          staleTime: 30_000, // app/post/[id].tsx:161 と一致
        })
        .catch(() => {});
    },
    [qc],
  );

  // ★ Reload-freshness: タブ再フォーカス時に BBS 一覧を invalidate (feed/community と同じ挙動)。
  //   'bbs-threads' prefix は ['bbs-threads'] と ['bbs-threads','my-communities',userId] の
  //   両 scope を覆う。staleTime 30s が連続フォーカスの dedupe を担うので過剰 refetch にならない。
  useFocusEffect(
    useCallback(() => {
      void qc.invalidateQueries({ queryKey: ['bbs-threads'] });
    }, [qc]),
  );

  // scope: ユーザーが明示的に切り替えるまでは「動的 default」=
  //   参加コミュあり → 'community' / なし → 'all'
  // 切替後は scopeRaw に固定される (ユーザーの意思を尊重)
  const [scopeRaw, setScopeRaw] = useState<Scope | null>(null);
  // myBbs の loading が終わるまでは表示しない (initial flash 防止)
  const effectiveScope: Scope =
    scopeRaw ?? (myBbs.loading ? 'community' : myBbs.hasJoinedCommunities ? 'community' : 'all');

  const setScope = (s: Scope) => setScopeRaw(s);
  const scopedSource = effectiveScope === 'community' ? myBbs : allBbs;
  const threads = scopedSource.threads;
  const loading = scopedSource.loading;
  const refreshing = scopedSource.refreshing;
  const refresh = scopedSource.refresh;
  // Smart skeleton timing — skeleton only after 200ms of continuous loading.
  // <200ms loads (cache hits) skip skeleton entirely to avoid flash.
  const showSkeleton = useDelayedLoading(loading, 200);

  // 既存 file 内に local 変数 `t` (setTimeout / loop param) があるので tr に rename
  const tr = useT();

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [category, setCategory] = useState<string>('すべて');
  const [sort, setSort] = useState<SortMode>('recent');

  // debounced を ref 経由で参照 — 行 press ハンドラを useCallback で安定化しても
  // 最新の検索語で CTR を記録できるようにする (debounced を deps に入れると
  // キーストロークごとにハンドラ identity が変わり ThreadRow の memo が効かない)。
  const debouncedRef = useRef(debounced);
  useEffect(() => {
    debouncedRef.current = debounced;
  }, [debounced]);

  useEffect(() => {
    // 短いクエリは早く応答 (autocomplete のテンポを上げる)
    const trimmed = search.trim();
    const delay = trimmed.length <= 2 ? 100 : 150;
    const t = setTimeout(() => setDebounced(trimmed), delay);
    return () => clearTimeout(t);
  }, [search]);

  const isDesktop = width > 720;
  const containerMaxWidth = 720;

  const parsedQuery = useMemo(() => parseQuery(debounced), [debounced]);
  const variants = useMemo(() => {
    const all = new Set<string>();
    for (const kw of parsedQuery.keywords) for (const v of generateVariants(kw)) all.add(v);
    for (const p of parsedQuery.phrases) all.add(p);
    return [...all].filter((s) => s.length >= 1);
  }, [parsedQuery]);

  // V4 シグナル: CTR boost (過去にこのクエリで開いたスレッド)
  const getCtrBoosts = useSearchClickStore((s) => s.getBoosts);
  const recordCtr = useSearchClickStore((s) => s.record);
  const ctrBoosts = useMemo(() => getCtrBoosts(debounced), [debounced, getCtrBoosts]);

  // コミュニティ紐付け済みスレッドのために、表示中スレッドの community_id 一覧を集めて
  // 名前/アイコンを一括 lookup する (大量にあっても 1 リクエスト)
  const communityIds = useMemo(() => {
    const ids = new Set<string>();
    for (const t of threads) {
      if (t.community_id) ids.add(t.community_id);
    }
    return Array.from(ids).sort();
  }, [threads]);
  const communityMetaQ = useQuery({
    queryKey: ['bbs-thread-communities', communityIds],
    queryFn: async () => {
      if (communityIds.length === 0) return {} as Record<string, { name: string; icon_emoji: string }>;
      const { data, error } = await supabase
        .from('communities')
        .select('id, name, icon_emoji')
        .in('id', communityIds);
      if (error) {
        console.warn('[bbs] community meta fetch failed:', error.message);
        return {} as Record<string, { name: string; icon_emoji: string }>;
      }
      const map: Record<string, { name: string; icon_emoji: string }> = {};
      for (const c of (data ?? []) as Array<{ id: string; name: string; icon_emoji: string }>) {
        map[c.id] = { name: c.name, icon_emoji: c.icon_emoji };
      }
      return map;
    },
    enabled: communityIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });
  const communityMeta = communityMetaQ.data ?? {};

  // スレッドごとの normalize 済みハイスタック / カテゴリを一度だけ計算してキャッシュ。
  // 以前は filter() / score() の中で各 thread × 各 variant ごとに deepNormalize を回しており
  // 1 キーストロークごとに 数千〜数万回 走っていた (debounce 後も再計算)。
  // threads が変わった時だけ作り直し、search 中は変えない。
  const threadDocs = useMemo(
    () => threads.map((t) => ({
      thread: t,
      haystackDeep: deepNormalize(t.title + ' ' + (t.category ?? '')),
      categoryDeep: t.category ? deepNormalize(t.category) : '',
      lastReplyMs: new Date(t.last_reply_at ?? t.created_at).getTime(),
    })),
    [threads],
  );

  // variant ごとに normalize 結果も pre-compute (filter ループの内側で 1 度だけ実行)
  const normalizedVariants = useMemo(
    () => variants.map((v) => deepNormalize(v)),
    [variants],
  );
  const normalizedExcludes = useMemo(
    () => parsedQuery.excludes.map((ex) => deepNormalize(ex)),
    [parsedQuery.excludes],
  );

  const filtered = useMemo(() => {
    const now = Date.now();
    let result = threadDocs;
    if (category !== 'すべて') {
      result = result.filter((d) => d.thread.category === category);
    }
    if (debounced.length > 0 && normalizedVariants.length > 0) {
      result = result.filter((d) =>
        normalizedVariants.some((nv) => d.haystackDeep.includes(nv)),
      );
    }
    for (const nx of normalizedExcludes) {
      result = result.filter((d) => !d.haystackDeep.includes(nx));
    }
    const scored = result.map((d) => {
      const t = d.thread;
      let score = 0;
      if (debounced) {
        let maxRel = 0;
        for (const v of variants) {
          const r = textRelevance(t.title, v);
          if (r > maxRel) maxRel = r;
        }
        score += maxRel;
        if (d.categoryDeep && normalizedVariants.some((nv) => d.categoryDeep.includes(nv))) score += 30;
      }
      score += Math.log(1 + t.replies_count) * 3;
      const ageH = (now - d.lastReplyMs) / 3600000;
      score += 10 * Math.exp(-ageH / 168);
      const ctrBoost = ctrBoosts[t.id] ?? 0;
      if (ctrBoost > 0) score += Math.min(100, ctrBoost * 15);
      return { item: t, score };
    });
    // sort は recent / popular の 2 択
    // (旧「関連度」はユーザーフィードバックで撤去 — score 計算は検索ヒット
    //  時の絞り込みに使われているので score 自体は残してある)
    if (sort === 'popular') {
      scored.sort((a, b) => b.item.replies_count - a.item.replies_count);
    } else {
      // default: recent — 最終返信時刻が新しい順 (返信ゼロは作成時刻に fallback)
      scored.sort((a, b) =>
        new Date(b.item.last_reply_at ?? b.item.created_at).getTime() -
        new Date(a.item.last_reply_at ?? a.item.created_at).getTime(),
      );
    }
    return scored;
  }, [threadDocs, debounced, variants, normalizedVariants, normalizedExcludes, category, sort, ctrBoosts]);

  const highlightTerms = useMemo(
    () => [...parsedQuery.keywords, ...parsedQuery.phrases].filter((s) => s.length > 0),
    [parsedQuery],
  );

  // 0 件ヒット時のもしかして候補 — スレッドタイトル群からタイポ補正
  const didYouMean = useMemo(() => {
    if (filtered.length > 0) return [] as string[];
    if (debounced.length < 2) return [];
    const kw = parsedQuery.keywords[0];
    if (!kw) return [];
    const titles = Array.from(new Set(threads.map((t) => t.title)));
    return findClosestK(kw, titles, 3, 0.5);
  }, [filtered.length, debounced, parsedQuery.keywords, threads]);

  const showResults = debounced.length > 0;

  // ===== 「上に戻る」ボタン用: scroll 位置に応じて表示を fade in/out =====
  // FlashList の ref を保持して scrollToOffset で先頭に戻す。
  // useAnimatedScrollHandler で scroll event を UI thread 直結に。
  // 旧版は JS handler 経由でフレーム毎に shared value にアクセスしており、
  // 長スレで JS bridge を往復していた。worklet 化で scroll jank を排除。
  const listRef = useRef<FlashList<{ item: BBSThread; score: number }>>(null);
  const backToTopOpacity = useSharedValue(0);
  const backToTopStyle = useAnimatedStyle(() => ({
    opacity: backToTopOpacity.value,
    transform: [
      { translateY: (1 - backToTopOpacity.value) * 16 }, // 下から ふわっ
    ],
  }));
  // 400px 超で表示。pull-to-refresh の負値域では出さない。
  // worklet 内で前回値と比較し、変化したときだけ withTiming を発火する。
  const handleScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      'worklet';
      const y = e.contentOffset.y;
      const target = y > 400 ? 1 : 0;
      if (backToTopOpacity.value !== target) {
        backToTopOpacity.value = withTiming(target, {
          duration: 180,
          easing: Easing.out(Easing.quad),
        });
      }
    },
  });
  const scrollToTop = () => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  };

  // 行ハンドラを安定化 (useCallback) — ThreadRow は React.memo なので
  // ハンドラ identity が render ごとに変わると memo が無効化される。
  // threadId を引数で受け取り、router / recordCtr / prefetchThread (全て安定) のみ依存。
  const handleRowPrefetch = useCallback(
    (threadId: string) => {
      prefetchThread(threadId);
    },
    [prefetchThread],
  );
  const handleRowPress = useCallback(
    (threadId: string, threadCategory: string | null | undefined) => {
      const q = debouncedRef.current;
      if (q) recordCtr(q, threadId);
      void logEvent({
        kind: 'thread_open',
        tags: [],
        category: threadCategory ?? undefined,
        thread_id: threadId,
      });
      router.push(`/bbs/${threadId}` as never);
    },
    [recordCtr, router],
  );
  const handlePressCommunity = useCallback(
    (communityId: string) => {
      router.push(`/community/${communityId}` as never);
    },
    [router],
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* ヘッダー (中央寄せ) */}
      <View style={{ alignItems: 'center', backgroundColor: C.bg, paddingTop: insets.top }}>
        <View style={{ width: '100%', maxWidth: containerMaxWidth, paddingHorizontal: SP['4'] }}>
          {/* LINE のトーク/友だち と同じ感覚の scope トグル
              アクティブ側だけ filled pill (C.text 背景に C.bg テキスト)、
              非アクティブは plain text。タップで切替。アイコン無し、シンプル。 */}
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: SP['3'], paddingBottom: SP['2'], gap: SP['1'] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['1'], flex: 1 }}>
              {([
                { v: 'community' as const, label: 'コミュニティ' },
                { v: 'all'       as const, label: 'すべて' },
              ]).map((m) => {
                const active = effectiveScope === m.v;
                return (
                  <PressableScale
                    key={m.v}
                    onPress={() => setScope(m.v)}
                    haptic="select"
                    hitSlop={6}
                    accessibilityLabel={`${m.label}${active ? ' (選択中)' : ''}`}
                    style={{
                      paddingHorizontal: SP['3'], paddingVertical: 7,
                      backgroundColor: active ? C.text : 'transparent',
                      borderRadius: R.full,
                    }}
                  >
                    <Text style={{
                      fontFamily: FONT.display, fontSize: 18, letterSpacing: -0.3,
                      color: active ? C.bg : C.text2,
                      fontWeight: active ? '800' : '600',
                    }}>
                      {m.label}
                    </Text>
                  </PressableScale>
                );
              })}
            </View>
            <PressableScale
              onPress={() => router.push('/bbs/create' as never)}
              haptic="confirm"
              accessibilityLabel="新しいスレッドを作成"
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 6,
                paddingHorizontal: SP['3'], paddingVertical: SP['2'],
                borderRadius: R.full,
                overflow: 'hidden',
                // primary CTA: 紫グラデ + soft halo (mypage と同じ pill)
                ...SHADOW.glow,
              }}
            >
              <LinearGradient
                colors={GRAD.primary}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
              />
              <Icon.plus size={16} color="#fff" strokeWidth={2.6} />
              <Text style={[T.smallM, { color: '#fff', fontWeight: '700' }]}>{tr('bbs.create_thread')}</Text>
            </PressableScale>
          </View>

          {/* 検索バー */}
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: SP['2'],
            paddingHorizontal: SP['3'], paddingVertical: SP['2'],
            backgroundColor: C.bg2,
            borderRadius: R.full,
            borderWidth: 1, borderColor: C.border,
            marginBottom: SP['2'],
          }}>
            <Icon.search size={18} color={C.text3} strokeWidth={2.2} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder={tr('bbs.search_placeholder')}
              placeholderTextColor={C.text3}
              keyboardAppearance="dark"
              selectionColor={C.accent}
              style={[T.body, { flex: 1, color: C.text, paddingVertical: 0 }]}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              onSubmitEditing={() => setDebounced(search.trim())}
              // 検索バーは常に focusable に — focus が即外れる/連続入力で消える bug を防ぐ
              blurOnSubmit={false}
              // memory DoS 対策: 検索クエリは 200 文字 cap
              maxLength={200}
            />
            {search.length > 0 && (
              <PressableScale
                onPress={() => setSearch('')}
                haptic="tap"
                hitSlop={12}
                accessibilityLabel="検索をクリア"
              >
                <Icon.close size={16} color={C.text3} strokeWidth={2.2} />
              </PressableScale>
            )}
          </View>
        </View>

        {/* カテゴリチップ + ソート行はコミュニティタブでは出さない
            ユーザーリクエスト: 「コミュニティの方ではなくしてほしい」
            状態 (category / sort) は保持するので、すべてに戻ったら復活する。 */}
        {effectiveScope === 'all' && (
          <>
            {/* カテゴリ (横スクロール) */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              // keyboard が出てる時にカテゴリをタップしてもまず select し、必要なら閉じる。
              // ('handled': 子の onPress が処理した時のみ keyboard を閉じる)
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{
                gap: 6, paddingHorizontal: SP['4'], paddingBottom: SP['2'],
              }}
              style={{ width: '100%' }}>
              {CATEGORIES.map((cat) => {
                const active = category === cat;
                const color = cat === 'すべて' ? C.accent : (CATEGORY_COLORS[cat] ?? C.accent);
                // active chip は accent gradient で塗る — mypage の "PolishedHero" と同じテイスト。
                // 「すべて」だけは紫主体の GRAD.primary、それ以外は category color → accent への
                // 軽い 2 色グラデで差別化 (色は category 色を残しつつ glow 感を出す)。
                const gradColors: readonly [string, string] = cat === 'すべて'
                  ? ([GRAD.primary[0], GRAD.primary[1]] as const)
                  : ([color, C.accent] as const);
                return (
                  <PressableScale
                    key={cat}
                    onPress={() => setCategory(cat)}
                    haptic="select"
                    hitSlop={6}
                    accessibilityLabel={`カテゴリ ${cat}${active ? ' (選択中)' : ''}`}
                    style={{
                      paddingHorizontal: SP['3'], paddingVertical: 6,
                      backgroundColor: active ? 'transparent' : C.bg2,
                      borderRadius: R.full,
                      borderWidth: 1,
                      borderColor: active ? color : C.border,
                      overflow: 'hidden',
                      ...(active ? SHADOW.xs : null),
                    }}
                  >
                    {active && (
                      <LinearGradient
                        colors={gradColors}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
                      />
                    )}
                    <Text style={[T.caption, { color: active ? '#fff' : C.text2, fontWeight: '700' }]}>
                      {cat}
                    </Text>
                  </PressableScale>
                );
              })}
            </ScrollView>

            {/* ソート + 件数 */}
            <View style={{
              width: '100%', maxWidth: containerMaxWidth,
              paddingHorizontal: SP['4'], paddingBottom: SP['3'],
              flexDirection: 'row', gap: 6, alignItems: 'center',
            }}>
              {([
                { v: 'recent',  label: '新着', emoji: '🕐' },
                { v: 'popular', label: '人気', emoji: '🔥' },
              ] as const).map((s) => {
                const active = sort === s.v;
                return (
                  <PressableScale
                    key={s.v}
                    onPress={() => setSort(s.v)}
                    haptic="tap"
                    hitSlop={10}
                    accessibilityLabel={`並び替え ${s.label}${active ? ' (選択中)' : ''}`}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 3,
                      paddingHorizontal: 8, paddingVertical: 4,
                      backgroundColor: active ? C.accentBg : 'transparent',
                      borderRadius: R.full,
                      borderWidth: 1, borderColor: active ? C.accent : C.border,
                    }}
                  >
                    <Text style={{ fontSize: 10 }}>{s.emoji}</Text>
                    <Text style={[T.caption, { color: active ? C.accentLight : C.text2, fontWeight: '600' }]}>
                      {s.label}
                    </Text>
                  </PressableScale>
                );
              })}
              <View style={{ flex: 1 }} />
              <Text style={[T.caption, { color: C.text3 }]}>{filtered.length.toLocaleString('ja-JP')}件</Text>
            </View>
          </>
        )}
      </View>

      {/* ヘッダー / リスト境界の hairline — 他タブ画面 (community, mypage) と統一 */}
      <View style={{ height: 1, backgroundColor: C.divider }} />

      {/* スレッドリスト — FlashList で virtualization。FlatList より recycle が
          効くので長い検索結果でも体感が滑らかになる。 */}
      <FlashList
        ref={listRef}
        data={filtered}
        keyExtractor={({ item }) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.accent} />
        }
        // 検索中に keyboard を表示したままスレッドをタップ → 1 タップで遷移したい
        // ('handled': タップが処理されたら keyboard を閉じる)
        keyboardShouldPersistTaps="handled"
        // viewport 外で +320px 先読み — スクロール中の白セル防止
        drawDistance={320}
        // 大量にあるスレッドカードを virtualization で省メモリ化
        removeClippedSubviews
        // 「上に戻る」ボタン用: 16ms throttle で過剰 re-render 防止 (60fps 想定)
        onScroll={handleScroll}
        scrollEventThrottle={16}
        // タイトル 2 行 + メタ情報 1 行 + 余白 + (community badge) で大体 132px くらい
        estimatedItemSize={132}
        // フリック時の慣性減速を速める
        decelerationRate="fast"
        // ★ extraData: communityMeta は遅延 fetch なので、初回 render 後に
        //   data が空 → 値ありに変わったときに re-render させないと
        //   コミュバッジが表示されないまま固まる。
        extraData={communityMeta}
        contentContainerStyle={{
          paddingBottom: TABBAR.height + insets.bottom + SP['10'],
        }}
        renderItem={(({ item: row }) => (
          <ThreadRow
            item={row.item}
            community={row.item.community_id ? communityMeta[row.item.community_id] : undefined}
            isDesktop={isDesktop}
            containerMaxWidth={containerMaxWidth}
            showResults={showResults}
            highlightTerms={highlightTerms}
            onPress={handleRowPress}
            onPrefetch={handleRowPrefetch}
            onPressCommunity={handlePressCommunity}
          />
        )) as ListRenderItem<{ item: BBSThread; score: number }>}
        ListEmptyComponent={
          loading ? (
            showSkeleton ? (
              <View>
                {Array.from({ length: 6 }).map((_, i) => <ThreadCardSkeleton key={`skel-thread-${i}`} />)}
              </View>
            ) : null
          ) : (
            <View style={{ width: '100%', maxWidth: containerMaxWidth, paddingHorizontal: SP['4'], paddingTop: SP['4'] }}>
              {showResults ? (
                <View style={{ padding: SP['8'], alignItems: 'center', gap: SP['3'] }}>
                  {/* 装飾絵文字 (🔎) 撤去 */}
                  <Text style={[T.h4, { color: C.text, textAlign: 'center' }]}>
                    「{debounced}」に一致するスレッドはありません
                  </Text>
                  {didYouMean.length > 0 ? (
                    <View style={{ alignItems: 'center', gap: 6 }}>
                      <Text style={[T.small, { color: C.text3 }]}>もしかして:</Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
                        {didYouMean.map((s) => (
                          <PressableScale
                            key={s}
                            onPress={() => setSearch(s)}
                            haptic="select"
                            style={{
                              paddingHorizontal: SP['3'], paddingVertical: 4,
                              backgroundColor: C.accentBg,
                              borderRadius: R.full,
                              borderWidth: 1, borderColor: C.accentSoft,
                            }}
                          >
                            <Text style={[T.caption, { color: C.accentLight, fontWeight: '700' }]} numberOfLines={1}>
                              {s}
                            </Text>
                          </PressableScale>
                        ))}
                      </View>
                    </View>
                  ) : (
                    <Text style={[T.small, { color: C.text3, textAlign: 'center' }]}>
                      別のキーワードやカテゴリを試してください
                    </Text>
                  )}
                  <PressableScale
                    onPress={() => router.push('/bbs/create' as never)}
                    haptic="confirm"
                    style={{
                      marginTop: SP['2'],
                      paddingHorizontal: SP['4'], paddingVertical: SP['2'],
                      borderRadius: R.full,
                      overflow: 'hidden',
                      ...SHADOW.glow,
                    }}
                  >
                    <LinearGradient
                      colors={GRAD.primary}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
                    />
                    <Text style={[T.smallM, { color: '#fff', fontWeight: '700' }]}>
                      ＋ このトピックでスレ立てする
                    </Text>
                  </PressableScale>
                </View>
              ) : effectiveScope === 'community' && !myBbs.hasJoinedCommunities ? (
                // コミュニティスコープで参加コミュ 0 件 → コミュニティ参加への導線
                <>
                  <View style={{
                    marginBottom: SP['4'],
                    padding: SP['4'], backgroundColor: C.accentBg,
                    borderRadius: R.lg, borderWidth: 1, borderColor: C.accentSoft,
                    gap: SP['1'],
                  }}>
                    <Text style={[T.smallM, { color: C.accentLight }]}>💬 コミュニティ掲示板</Text>
                    <Text style={[T.small, { color: C.text2 }]}>
                      コミュニティに参加すると、そのコミュニティの掲示板がここに集まります。
                    </Text>
                  </View>
                  <PolishedEmpty
                    emoji="🧭"
                    title="まずコミュニティに参加しよう"
                    message="興味のあるコミュニティを探して、議論に参加してみよう"
                    actionLabel="コミュニティを探す"
                    onAction={() => router.push('/(tabs)/community/discover' as never)}
                  />
                </>
              ) : (
                <>
                  <View style={{
                    marginBottom: SP['4'],
                    padding: SP['4'], backgroundColor: C.accentBg,
                    borderRadius: R.lg, borderWidth: 1, borderColor: C.accentSoft,
                    gap: SP['1'],
                  }}>
                    <Text style={[T.smallM, { color: C.accentLight }]}>💬 匿名掲示板とは</Text>
                    <Text style={[T.small, { color: C.text2 }]}>
                      時系列で流れない議論用スペース。アニメ実況、相談、議論など、まとまった話題を続けられます。
                    </Text>
                  </View>
                  <PolishedEmpty
                    emoji="💬"
                    title={effectiveScope === 'community' ? '参加コミュにまだスレッドがありません' : 'まだスレッドがありません'}
                    message={effectiveScope === 'community' ? '最初の 1 本を立てて議論を始めよう' : '最初のスレッドを立ててみよう'}
                    actionLabel="スレ立てする"
                    onAction={() => router.push('/bbs/create' as never)}
                  />
                </>
              )}
            </View>
          )
        }
      />

      {/* 「上に戻る」FAB — スクロール 400px 超で表示 (reanimated でふわっと in/out)。
          TABBAR の上に乗せる位置に固定。pointerEvents は opacity=0 のときも
          子要素がタッチを吸わないように 'box-none' (不可視時は実質 no-op)。 */}
      <Animated.View
        pointerEvents="box-none"
        style={[
          {
            position: 'absolute',
            right: SP['4'],
            bottom: TABBAR.height + insets.bottom + SP['3'],
          },
          backToTopStyle,
        ]}
      >
        <PressableScale
          onPress={scrollToTop}
          haptic="tap"
          accessibilityLabel="一番上に戻る"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: SP['3'],
            paddingVertical: SP['2'],
            borderRadius: R.full,
            overflow: 'hidden',
            ...SHADOW.glow,
          }}
        >
          <LinearGradient
            colors={GRAD.primary}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
          />
          <Icon.chevronU size={16} color="#fff" strokeWidth={2.6} />
          <Text style={[T.caption, { color: '#fff', fontWeight: '700', fontSize: 11 }]}>
            上に戻る
          </Text>
        </PressableScale>
      </Animated.View>
    </View>
  );
}

// ============================================================
// PolishedEmpty — 96x96 gradient circle + emoji + CTA gradient pill
// ============================================================
// mypage hero と同じ GRAD.primary を使った emoji 円 + CTA pill。
// 既存 EmptyState (icon + Button) より hero っぽさを出すための内部 component。
// BBS タブ専用 (community タブにも同等 component を別途用意).
function PolishedEmpty({
  emoji,
  title,
  message,
  actionLabel,
  onAction,
}: {
  emoji: string;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={{ padding: SP['8'], alignItems: 'center', gap: SP['4'] }}>
      <View
        style={{
          width: 96, height: 96, borderRadius: 48,
          alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
          ...SHADOW.glow,
        }}
      >
        <LinearGradient
          colors={GRAD.primary}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
        />
        <Text style={{ fontSize: 44 }} accessibilityLabel="">{emoji}</Text>
      </View>
      <Text
        style={[T.h3, { color: C.text, textAlign: 'center', letterSpacing: -0.3 }]}
      >
        {title}
      </Text>
      {message && (
        <Text style={[T.body, { color: C.text2, textAlign: 'center', maxWidth: 320 }]}>
          {message}
        </Text>
      )}
      {actionLabel && onAction && (
        <PressableScale
          onPress={onAction}
          haptic="confirm"
          style={{
            marginTop: SP['2'],
            paddingHorizontal: SP['5'], paddingVertical: SP['3'],
            borderRadius: R.full,
            overflow: 'hidden',
            ...SHADOW.glow,
          }}
        >
          <LinearGradient
            colors={GRAD.primary}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
          />
          <Text style={[T.bodyMd, { color: '#fff', fontWeight: '700', letterSpacing: 0.2 }]}>
            {actionLabel}
          </Text>
        </PressableScale>
      )}
    </View>
  );
}

// ============================================================
// ThreadRow — FlashList の 1 行 (animation state-per-row 用に分離)
// ------------------------------------------------------------
// 設計:
//   - FlashList の row は recycle されるが、shared value は instance 単位で
//     useRef のように維持されるので、それぞれの thread 行に固有の
//     entrance / hot pulse / comment-count bump アニメを持たせられる
//   - useReducedMotion() を尊重 — true のとき shared value を最終状態に
//     固定し、loop / sequence を一切走らせない (worklet 側でも判定)
// ============================================================
type ThreadRowProps = {
  item: BBSThread;
  community: { name: string; icon_emoji: string } | undefined;
  isDesktop: boolean;
  containerMaxWidth: number;
  showResults: boolean;
  highlightTerms: string[];
  // 安定化のため id を引数で受ける (親側で useCallback 化、ThreadRow は React.memo)
  onPress: (threadId: string, threadCategory: string | null | undefined) => void;
  onPrefetch: (threadId: string) => void;
  onPressCommunity: (communityId: string) => void;
};

function ThreadRowBase({
  item,
  community,
  isDesktop,
  containerMaxWidth,
  showResults,
  highlightTerms,
  onPress,
  onPrefetch,
  onPressCommunity,
}: ThreadRowProps) {
  const themeC = useColors();
  const reduceMotion = useReducedMotion();

  const catColor = item.category ? (CATEGORY_COLORS[item.category] ?? themeC.accent) : themeC.accent;
  // 「hot」判定 — 返信 20 件超 or (10 件超 + 直近 24h で活発)
  const lastReplyMs = new Date(item.last_reply_at ?? item.created_at).getTime();
  const recentH = (Date.now() - lastReplyMs) / 3600000;
  const isHot = item.replies_count > 20 || (item.replies_count > 10 && recentH < 24);

  // --- entrance: opacity 0 → 1 + translateY 8 → 0 over 220ms (初回 mount のみ) ---
  const isFirstMount = useRef(true);
  const entranceOpacity = useSharedValue(reduceMotion ? 1 : 0);
  const entranceTranslateY = useSharedValue(reduceMotion ? 0 : 8);
  useEffect(() => {
    if (!isFirstMount.current) return;
    isFirstMount.current = false;
    if (reduceMotion) {
      entranceOpacity.value = 1;
      entranceTranslateY.value = 0;
      return;
    }
    entranceOpacity.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.quad) });
    entranceTranslateY.value = withTiming(0, { duration: 220, easing: Easing.out(Easing.quad) });
  }, [reduceMotion, entranceOpacity, entranceTranslateY]);
  const entranceStyle = useAnimatedStyle(() => ({
    opacity: entranceOpacity.value,
    transform: [{ translateY: entranceTranslateY.value }],
  }));

  // --- comment count bump: replies_count が増えた時に icon を 1 → 1.15 → spring back ---
  const prevCommentCount = useRef(item.replies_count);
  const commentScale = useSharedValue(1);
  useEffect(() => {
    if (prevCommentCount.current !== item.replies_count) {
      const grew = item.replies_count > prevCommentCount.current;
      prevCommentCount.current = item.replies_count;
      if (grew && !reduceMotion) {
        commentScale.value = withSequence(
          withTiming(1.15, { duration: 140, easing: Easing.out(Easing.quad) }),
          withSpring(1, SPRING_SNAPPY),
        );
      }
    }
  }, [item.replies_count, reduceMotion, commentScale]);
  const commentScaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: commentScale.value }],
  }));

  // --- hot indicator pulse: 1 → 1.05 → 1 loop, 1400ms (is_hot のときだけ) ---
  const hotPulse = useSharedValue(1);
  useEffect(() => {
    if (!isHot || reduceMotion) {
      hotPulse.value = 1;
      return;
    }
    hotPulse.value = withRepeat(
      withSequence(
        withTiming(1.05, { duration: 700, easing: Easing.inOut(Easing.quad) }),
        withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, [isHot, reduceMotion, hotPulse]);
  const hotPulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: hotPulse.value }],
  }));

  return (
    <Animated.View
      style={[
        { width: '100%', maxWidth: containerMaxWidth, paddingHorizontal: SP['4'], paddingBottom: SP['3'], alignSelf: 'center' },
        entranceStyle,
      ]}
    >
      <PressableScale
        onPress={() => onPress(item.id, item.category)}
        // onPressIn で遷移先 (/post/{id}) の cache を先読み。press → router.push の間
        // (~100-300ms) に warm されるので詳細画面が cache hit で即描画される。
        onPressIn={() => onPrefetch(item.id)}
        haptic="tap"
        scaleValue={0.97}
        // glass 風: 半透明 background + 細い縁 + ふんわり shadow.xs
        // hot スレは少し強い border + glow shadow で前に出す。
        // (FlashList の recycle 性能を保つため BlurView は使わない. View only)
        style={{
          flexDirection: 'row',
          borderRadius: R.lg,
          backgroundColor: isHot ? 'rgba(248,122,180,0.06)' : themeC.glass,
          borderWidth: 1,
          borderColor: isHot ? 'rgba(248,122,180,0.22)' : themeC.glassBorder,
          overflow: 'hidden',
          ...(isHot ? SHADOW.sm : SHADOW.xs),
        }}
      >
        {/* 左カラーバー — hot スレは GRAD.warm (桃→橙) で厚め (6px)。
            それ以外は category color → accent への gradient で 4px。 */}
        <View style={{ width: isHot ? 6 : 4, overflow: 'hidden' }}>
          <LinearGradient
            colors={isHot ? GRAD.warm : ([catColor, themeC.accent] as const)}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
          />
        </View>
        {/* 本体 */}
        <View style={{ flex: 1, padding: SP['3'], gap: SP['2'] }}>
          {/* コミュニティ紐付けバッジ (一般公開 + community_id がある場合)
              ネストされた PressableScale: 単独の tap target。outer の thread row tap
              は RN の responder system 上、deepest child が勝つので競合しないが、
              web の bubble に備えて stopPropagation も呼ぶ。 */}
          {community && item.community_id && (
            <View style={{ flexDirection: 'row' }}>
              <PressableScale
                onPress={(e) => {
                  // web 環境では synthetic event に stopPropagation が乗る
                  (e as unknown as { stopPropagation?: () => void }).stopPropagation?.();
                  if (item.community_id) onPressCommunity(item.community_id);
                }}
                haptic="select"
                scaleValue={0.96}
                hitSlop={6}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 4,
                  paddingHorizontal: SP['2'], paddingVertical: 2,
                  backgroundColor: themeC.bg3,
                  borderRadius: R.full,
                  borderWidth: 1, borderColor: themeC.border,
                }}
              >
                <Text style={{ fontSize: 10 }}>{community.icon_emoji || '🏠'}</Text>
                <Text style={[T.caption, { color: themeC.text2, fontSize: 10, fontWeight: '600' }]} numberOfLines={1}>
                  #{community.name}
                </Text>
              </PressableScale>
            </View>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
            {item.category && (
              <View style={{
                paddingHorizontal: SP['2'], paddingVertical: 2,
                backgroundColor: catColor + '22',
                borderRadius: R.sm,
                borderWidth: 1, borderColor: catColor + '55',
              }}>
                <Text style={[T.caption, { color: catColor, fontWeight: '700', fontSize: 10 }]}>
                  {item.category}
                </Text>
              </View>
            )}
            <View style={{ flex: 1 }} />
            {/* 最終返信時刻 — 控えめだが clock icon で意味を明示 */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Icon.clock size={11} color={themeC.text3} strokeWidth={2.2} />
              <Text style={[T.caption, { color: themeC.text3, fontSize: 11 }]}>
                {formatRelative(item.last_reply_at ?? item.created_at)}
              </Text>
            </View>
          </View>
          {showResults ? (
            <HighlightedText
              text={item.title}
              terms={highlightTerms}
              style={[T.h4, { color: themeC.text, fontWeight: '700', letterSpacing: -0.2, lineHeight: 23 }]}
              numberOfLines={2}
            />
          ) : (
            <Text
              style={[T.h4, { color: themeC.text, fontWeight: '700', letterSpacing: -0.2, lineHeight: 23 }]}
              numberOfLines={2}
            >
              {item.title}
            </Text>
          )}
          <View style={{ flexDirection: 'row', gap: SP['3'], alignItems: 'center' }}>
            {/* 返信数 — hot は色強調 + サイズ up で前に出す
                comment_count が増えると icon が 1.15 まで膨らんで spring back する */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Animated.View style={commentScaleStyle}>
                <Icon.comment
                  size={14}
                  color={isHot ? themeC.pink : themeC.text2}
                  strokeWidth={2.2}
                />
              </Animated.View>
              <Text style={[T.small, {
                color: isHot ? themeC.pink : themeC.text2,
                fontWeight: '700',
                fontSize: 13,
              }]}>
                {item.replies_count.toLocaleString('ja-JP')}
              </Text>
              <Text style={[T.caption, { color: themeC.text3, fontSize: 11, marginLeft: 1 }]}>
                返信
              </Text>
            </View>
            {isHot && (
              <Animated.View
                style={[
                  {
                    flexDirection: 'row', alignItems: 'center', gap: 2,
                    paddingHorizontal: 6, paddingVertical: 1,
                    backgroundColor: 'rgba(248,122,180,0.15)',
                    borderRadius: R.sm,
                    borderWidth: 1,
                    borderColor: 'rgba(248,122,180,0.32)',
                  },
                  hotPulseStyle,
                ]}
              >
                <Text style={{ fontSize: 10 }}>🔥</Text>
                <Text style={{ fontSize: 10, color: '#F87AB4', fontWeight: '700' }}>賑わい中</Text>
              </Animated.View>
            )}
          </View>
        </View>
        {/* 右の chevron (デスクトップで) */}
        {isDesktop && (
          <View style={{ paddingHorizontal: SP['3'], justifyContent: 'center' }}>
            <Icon.chevronR size={18} color={themeC.text3} strokeWidth={2.2} />
          </View>
        )}
      </PressableScale>
    </Animated.View>
  );
}

// React.memo — FlashList の再 render / extraData 変化 (communityMeta 遅延 fetch) や
// 検索キーストロークで親が再 render しても、props が変わらない行は再 render を skip。
// callback は親側で useCallback 安定化済み、item は query data の安定参照なので
// default の shallow 比較で十分機能する。
const ThreadRow = memo(ThreadRowBase);
