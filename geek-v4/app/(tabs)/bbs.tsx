import { useState, useMemo, useEffect } from 'react';
import { View, Text, FlatList, ScrollView, TextInput, useWindowDimensions, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { normalize } from '@/lib/search/tokenize';
import { textRelevance } from '@/lib/utils/searchAlgo';
import { useSearchClickStore } from '@/stores/searchClickStore';

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
    const t = setTimeout(() => setDebounced(search.trim()), 200);
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

  const filtered = useMemo(() => {
    let result = threads;
    if (category !== 'すべて') {
      result = result.filter((t) => t.category === category);
    }
    if (debounced.length > 0 && variants.length > 0) {
      result = result.filter((t) => {
        const haystack = normalize(t.title + ' ' + (t.category ?? ''));
        return variants.some((v) => haystack.includes(normalize(v)));
      });
    }
    for (const ex of parsedQuery.excludes) {
      const n = normalize(ex);
      result = result.filter((t) => !normalize(t.title + ' ' + (t.category ?? '')).includes(n));
    }
    const scored = result.map((t) => {
      let score = 0;
      if (debounced) {
        let maxRel = 0;
        for (const v of variants) {
          const r = textRelevance(t.title, v);
          if (r > maxRel) maxRel = r;
        }
        score += maxRel;
        if (t.category && variants.some((v) => normalize(t.category!).includes(normalize(v)))) score += 30;
      }
      score += Math.log(1 + t.replies_count) * 3;
      const ageH = (Date.now() - new Date(t.last_reply_at ?? t.created_at).getTime()) / 3600000;
      score += 10 * Math.exp(-ageH / 168);
      // CTR boost: 過去にこのクエリで開いたスレッドを優遇
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
  }, [threads, debounced, variants, category, sort, parsedQuery]);

  const highlightTerms = useMemo(
    () => [...parsedQuery.keywords, ...parsedQuery.phrases].filter((s) => s.length > 0),
    [parsedQuery],
  );

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
          <Text style={[T.caption, { color: C.text3 }]}>{filtered.length}件</Text>
        </View>
      </View>

      {/* スレッドリスト */}
      <FlatList
        data={filtered}
        keyExtractor={({ item }) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.accent} />
        }
        contentContainerStyle={{
          paddingBottom: TABBAR.height + insets.bottom + SP['10'],
          alignItems: 'center',
        }}
        renderItem={({ item: { item } }) => {
          const catColor = item.category ? (CATEGORY_COLORS[item.category] ?? C.accent) : C.accent;
          return (
            <View style={{ width: '100%', maxWidth: containerMaxWidth, paddingHorizontal: SP['4'], paddingBottom: SP['3'] }}>
              <PressableScale
                onPress={() => {
                  if (debounced) recordCtr(debounced, item.id);
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
                        {item.replies_count}
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
                  <Text style={[T.small, { color: C.text3, textAlign: 'center' }]}>
                    別のキーワードやカテゴリを試してください
                  </Text>
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
