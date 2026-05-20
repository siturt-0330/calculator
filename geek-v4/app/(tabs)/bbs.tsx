import { useState, useMemo, useEffect } from 'react';
import { View, Text, FlatList, ScrollView, TextInput, useWindowDimensions, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useBBS } from '@/hooks/useBBS';
import { PressableScale } from '@/components/ui/PressableScale';
import { EmptyState } from '@/components/ui/EmptyState';
import { HighlightedText } from '@/components/ui/HighlightedText';
import { ThreadCardSkeleton } from '@/components/ui/Skeleton';
import { Icon } from '@/constants/icons';
import { C, R, SP } from '@/design/tokens';
import { T, FONT } from '@/design/typography';
import { TABBAR } from '@/design/tabbar';
import { formatRelative } from '@/lib/utils/date';
import { parseQuery } from '@/lib/search/queryParser';
import { generateVariants } from '@/lib/search/variants';
import { deepNormalize } from '@/lib/search/tokenize';
import { findClosestK } from '@/lib/search/typoCorrect';
import { textRelevance } from '@/lib/utils/searchAlgo';
import { useSearchClickStore } from '@/stores/searchClickStore';
import { logEvent } from '@/lib/personalize';
import { supabase } from '@/lib/supabase';

type SortMode = 'recent' | 'popular' | 'relevance';

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
  const { threads, loading, refreshing, refresh } = useBBS();

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [category, setCategory] = useState<string>('すべて');
  const [sort, setSort] = useState<SortMode>('recent');

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
    if (sort === 'recent') {
      scored.sort((a, b) =>
        new Date(b.item.last_reply_at ?? b.item.created_at).getTime() -
        new Date(a.item.last_reply_at ?? a.item.created_at).getTime(),
      );
    } else if (sort === 'popular') {
      scored.sort((a, b) => b.item.replies_count - a.item.replies_count);
    } else {
      scored.sort((a, b) => b.score - a.score);
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

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* ヘッダー (中央寄せ) */}
      <View style={{ alignItems: 'center', backgroundColor: C.bg, paddingTop: insets.top }}>
        <View style={{ width: '100%', maxWidth: containerMaxWidth, paddingHorizontal: SP['4'] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: SP['3'], paddingBottom: SP['2'] }}>
            <Text style={{ fontFamily: FONT.display, fontSize: 26, color: C.text, letterSpacing: -0.3, flex: 1 }}>
              掲示板
            </Text>
            <PressableScale
              onPress={() => router.push('/bbs/create' as never)}
              haptic="confirm"
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 4,
                paddingHorizontal: SP['3'], paddingVertical: SP['2'],
                backgroundColor: C.accent, borderRadius: R.full,
              }}
            >
              <Icon.plus size={16} color="#fff" strokeWidth={2.6} />
              <Text style={[T.smallM, { color: '#fff', fontWeight: '700' }]}>スレ立て</Text>
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
              placeholder="スレッドを検索"
              placeholderTextColor={C.text3}
              keyboardAppearance="dark"
              selectionColor={C.accent}
              style={[T.body, { flex: 1, color: C.text, paddingVertical: 0 }]}
              autoCorrect={false}
              autoCapitalize="none"
            />
            {search.length > 0 && (
              <PressableScale onPress={() => setSearch('')} haptic="tap">
                <Icon.close size={16} color={C.text3} strokeWidth={2.2} />
              </PressableScale>
            )}
          </View>
        </View>

        {/* カテゴリ (横スクロール) */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            gap: 6, paddingHorizontal: SP['4'], paddingBottom: SP['2'],
          }}
          style={{ width: '100%' }}>
          {CATEGORIES.map((cat) => {
            const active = category === cat;
            const color = cat === 'すべて' ? C.accent : (CATEGORY_COLORS[cat] ?? C.accent);
            return (
              <PressableScale
                key={cat}
                onPress={() => setCategory(cat)}
                haptic="select"
                style={{
                  paddingHorizontal: SP['3'], paddingVertical: 6,
                  backgroundColor: active ? color : C.bg2,
                  borderRadius: R.full,
                  borderWidth: 1, borderColor: active ? color : C.border,
                }}
              >
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
            { v: 'recent',    label: '新着',    emoji: '🕐' },
            { v: 'popular',   label: '人気',    emoji: '🔥' },
            { v: 'relevance', label: '関連度', emoji: '🎯' },
          ] as const).map((s) => {
            const active = sort === s.v;
            return (
              <PressableScale
                key={s.v}
                onPress={() => setSort(s.v)}
                haptic="tap"
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
      </View>

      {/* スレッドリスト */}
      <FlatList
        data={filtered}
        keyExtractor={({ item }) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.accent} />
        }
        // 長いリストでオフスクリーンの subview を unmount し、メモリ・描画コストを下げる。
        // FlatList の windowSize / maxToRenderPerBatch も控えめにしてフレーム drop を抑える。
        removeClippedSubviews
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={11}
        contentContainerStyle={{
          paddingBottom: TABBAR.height + insets.bottom + SP['10'],
          alignItems: 'center',
        }}
        renderItem={({ item: { item } }) => {
          const catColor = item.category ? (CATEGORY_COLORS[item.category] ?? C.accent) : C.accent;
          const community = item.community_id ? communityMeta[item.community_id] : undefined;
          return (
            <View style={{ width: '100%', maxWidth: containerMaxWidth, paddingHorizontal: SP['4'], paddingBottom: SP['3'] }}>
              <PressableScale
                onPress={() => {
                  if (debounced) recordCtr(debounced, item.id);
                  void logEvent({
                    kind: 'thread_open',
                    tags: [],
                    category: item.category ?? undefined,
                    thread_id: item.id,
                  });
                  router.push(`/bbs/${item.id}` as never);
                }}
                haptic="tap"
                style={{
                  flexDirection: 'row',
                  borderRadius: R.lg,
                  backgroundColor: C.bg2,
                  borderWidth: 1,
                  borderColor: C.border,
                  overflow: 'hidden',
                }}
              >
                {/* 左カラーバー */}
                <View style={{ width: 4, backgroundColor: catColor }} />
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
                          router.push(`/community/${item.community_id}` as never);
                        }}
                        haptic="select"
                        scaleValue={0.96}
                        hitSlop={6}
                        style={{
                          flexDirection: 'row', alignItems: 'center', gap: 4,
                          paddingHorizontal: SP['2'], paddingVertical: 2,
                          backgroundColor: C.bg3,
                          borderRadius: R.full,
                          borderWidth: 1, borderColor: C.border,
                        }}
                      >
                        <Text style={{ fontSize: 10 }}>{community.icon_emoji || '🏠'}</Text>
                        <Text style={[T.caption, { color: C.text2, fontSize: 10, fontWeight: '600' }]} numberOfLines={1}>
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
                    <Text style={[T.caption, { color: C.text3, fontSize: 11 }]}>
                      {formatRelative(item.last_reply_at ?? item.created_at)}
                    </Text>
                  </View>
                  {showResults ? (
                    <HighlightedText
                      text={item.title}
                      terms={highlightTerms}
                      style={[T.h4, { color: C.text, fontWeight: '700' }]}
                      numberOfLines={2}
                    />
                  ) : (
                    <Text style={[T.h4, { color: C.text, fontWeight: '700' }]} numberOfLines={2}>
                      {item.title}
                    </Text>
                  )}
                  <View style={{ flexDirection: 'row', gap: SP['3'], alignItems: 'center' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Icon.comment size={13} color={C.text3} strokeWidth={2.2} />
                      <Text style={[T.small, { color: C.text3, fontWeight: '600' }]}>
                        {item.replies_count.toLocaleString('ja-JP')}
                      </Text>
                    </View>
                    {item.replies_count > 10 && (
                      <View style={{
                        flexDirection: 'row', alignItems: 'center', gap: 2,
                        paddingHorizontal: 6, paddingVertical: 1,
                        backgroundColor: 'rgba(255,140,48,0.15)',
                        borderRadius: R.sm,
                      }}>
                        <Text style={{ fontSize: 10 }}>🔥</Text>
                        <Text style={{ fontSize: 10, color: '#FF8C30', fontWeight: '700' }}>賑わい中</Text>
                      </View>
                    )}
                  </View>
                </View>
                {/* 右の chevron (デスクトップで) */}
                {isDesktop && (
                  <View style={{ paddingHorizontal: SP['3'], justifyContent: 'center' }}>
                    <Icon.chevronR size={18} color={C.text3} strokeWidth={2.2} />
                  </View>
                )}
              </PressableScale>
            </View>
          );
        }}
        ListEmptyComponent={
          loading ? (
            <View>
              {Array.from({ length: 5 }).map((_, i) => <ThreadCardSkeleton key={i} />)}
            </View>
          ) : (
            <View style={{ width: '100%', maxWidth: containerMaxWidth, paddingHorizontal: SP['4'], paddingTop: SP['4'] }}>
              {showResults ? (
                <View style={{ padding: SP['8'], alignItems: 'center', gap: SP['3'] }}>
                  <Text style={{ fontSize: 40 }}>🔎</Text>
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
                      backgroundColor: C.accent, borderRadius: R.full,
                    }}
                  >
                    <Text style={[T.smallM, { color: '#fff', fontWeight: '700' }]}>
                      ＋ このトピックでスレ立てする
                    </Text>
                  </PressableScale>
                </View>
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
                  <EmptyState
                    icon={Icon.bbs}
                    title="まだスレッドがありません"
                    message="最初のスレッドを立ててみよう"
                    actionLabel="スレ立てする"
                    onAction={() => router.push('/bbs/create' as never)}
                    tone="accent"
                  />
                </>
              )}
            </View>
          )
        }
      />
    </View>
  );
}
