import { View, Text, ScrollView, RefreshControl, KeyboardAvoidingView, Platform } from 'react-native';
import { useState, useMemo } from 'react';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useQuery } from '@tanstack/react-query';
import { C, R, SP, SHADOW } from '../../../design/tokens';
import { T } from '../../../design/typography';
import { Input } from '../../../components/ui/Input';
import { PressableScale } from '../../../components/ui/PressableScale';
import { Skeleton, SkeletonCircle } from '../../../components/ui/Skeleton';
import { CommunityIcon } from '../../../components/ui/CommunityIcon';
import { BackButton } from '../../../components/nav/BackButton';
import { Icon } from '../../../constants/icons';
import {
  searchCommunities,
  fetchOfficialCommunities,
  type CommunityHit,
  type MatchedBy,
} from '../../../lib/api/communities';
import { previewVariants } from '../../../lib/search/variants';
import { OfficialBadge } from '../../../components/community/OfficialBadge';
import { TABBAR } from '../../../design/tabbar';
import { useDebounce } from '../../../hooks/useDebounce';

// マッチ理由 → ラベル + 色
function matchLabel(m: MatchedBy): { label: string; color: string; bg: string } | null {
  switch (m) {
    case 'name-exact':    return { label: '完全一致', color: '#fff', bg: C.accent };
    case 'name-prefix':   return { label: '先頭一致', color: '#fff', bg: C.accent };
    case 'name-contains': return null; // 普通の name match は表示しない (デフォルト)
    case 'desc-contains': return { label: '説明にマッチ', color: C.text2, bg: C.bg3 };
    case 'synonym':       return { label: '別名にマッチ', color: C.amber, bg: C.amberBg };
    default:              return null;
  }
}

export default function DiscoverCommunitiesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [officialOnly, setOfficialOnly] = useState(false);

  // useDebounce で query を遅延適用 — React Query の queryKey に使う
  // 短いクエリ (≤2 文字) は 120ms、それ以上は 180ms
  const debounceMs = query.trim().length <= 2 ? 120 : 180;
  const debouncedQuery = useDebounce(query, debounceMs);

  // 検索結果 — React Query で in-flight 競合と stale をまとめて解決
  const searchQ = useQuery({
    queryKey: ['discover-search', debouncedQuery.trim(), officialOnly],
    queryFn: () =>
      searchCommunities({
        query: debouncedQuery.trim() || undefined,
        officialOnly,
        limit: 30,
      }),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    placeholderData: (prev) => prev, // クエリ変化中もチラつかず前回結果を残す
  });

  // 公式コミュニティ — クエリ無し画面の上部 horizontal scroll
  const { data: officialCommunities = [] } = useQuery({
    queryKey: ['discover-official'],
    queryFn: () => fetchOfficialCommunities(10),
    staleTime: 60_000,
  });

  const results: CommunityHit[] = searchQ.data ?? [];
  const loading = searchQ.isLoading;
  const refreshing = searchQ.isFetching && !searchQ.isLoading;
  const onRefresh = () => searchQ.refetch();

  const hasQuery = query.trim().length > 0;
  const showOfficialSection = !hasQuery && officialCommunities.length > 0;

  // 「これも検索しています」preview — 同義語ピル表示用
  const previewSyns = useMemo(() => {
    if (!hasQuery) return [];
    return previewVariants(query.trim(), 'ja', 3);
  }, [query, hasQuery]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: C.bg }}
    >
      <View
        style={{
          paddingTop: insets.top + SP['2'],
          paddingHorizontal: SP['4'],
          paddingBottom: SP['3'],
          gap: SP['3'],
          borderBottomWidth: 1,
          borderBottomColor: C.border,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
          <BackButton />
          <Text style={[T.h2, { color: C.text, flex: 1 }]}>コミュニティを探す</Text>
          <PressableScale
            onPress={() => router.push('/community/create' as never)}
            haptic="confirm"
            style={{
              paddingHorizontal: SP['3'],
              paddingVertical: SP['2'],
              backgroundColor: C.accent,
              borderRadius: R.full,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <Icon.plus size={14} color="#fff" strokeWidth={2.6} />
            <Text style={[T.caption, { color: '#fff', fontWeight: '700' }]}>作成</Text>
          </PressableScale>
        </View>
        <View style={{ position: 'relative', justifyContent: 'center' }}>
          <Input
            icon={Icon.search}
            value={query}
            onChangeText={setQuery}
            placeholder="名前・説明・別名で検索"
            returnKeyType="search"
            autoFocus
            keyboardAppearance="dark"
            selectionColor={C.accent}
          />
          {query.length > 0 && (
            <PressableScale
              onPress={() => setQuery('')}
              haptic="tap"
              hitSlop={10}
              accessibilityLabel="検索キーワードをクリア"
              style={{
                position: 'absolute',
                right: SP['2'],
                top: 0,
                bottom: 0,
                justifyContent: 'center',
                paddingHorizontal: SP['2'],
              }}
            >
              <Icon.close size={16} color={C.text3} strokeWidth={2.4} />
            </PressableScale>
          )}
        </View>

        {/* これも検索しています (同義語プレビュー) */}
        {previewSyns.length > 0 && (
          <Animated.View
            entering={FadeIn.duration(180)}
            style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}
          >
            <Text style={[T.caption, { color: C.text3 }]}>これも検索:</Text>
            {previewSyns.map((s) => (
              <PressableScale
                key={s}
                onPress={() => setQuery(s)}
                haptic="tap"
                hitSlop={6}
                style={{
                  paddingHorizontal: SP['2'],
                  paddingVertical: 3,
                  backgroundColor: C.bg2,
                  borderWidth: 1,
                  borderColor: C.border,
                  borderRadius: R.full,
                }}
              >
                <Text style={[T.caption, { color: C.text2, fontWeight: '600' }]}>{s}</Text>
              </PressableScale>
            ))}
          </Animated.View>
        )}

        {/* フィルタ chip 行 */}
        <View style={{ flexDirection: 'row', gap: SP['2'], flexWrap: 'wrap' }}>
          <PressableScale
            onPress={() => setOfficialOnly((v) => !v)}
            haptic="tap"
            scaleValue={0.94}
            accessibilityRole="button"
            accessibilityState={{ selected: officialOnly }}
            accessibilityLabel="公式のみ表示"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: SP['3'],
              paddingVertical: 6,
              backgroundColor: officialOnly ? C.accentBg : C.bg2,
              borderWidth: 1,
              borderColor: officialOnly ? C.accent : C.border,
              borderRadius: R.full,
            }}
          >
            <Icon.check size={12} color={officialOnly ? C.accent : C.text3} strokeWidth={3} />
            <Text
              style={[
                T.caption,
                { color: officialOnly ? C.accent : C.text2, fontWeight: '700' },
              ]}
            >
              公式のみ
            </Text>
          </PressableScale>
          {/* 結果件数 + 検索中 indicator */}
          <View style={{ flex: 1, alignItems: 'flex-end', justifyContent: 'center' }}>
            {hasQuery && !loading && results.length > 0 && (
              <Text style={[T.caption, { color: C.text3 }]}>
                {results.length.toLocaleString('ja-JP')} 件
              </Text>
            )}
            {(loading || refreshing) && (
              <Text style={[T.caption, { color: C.accent }]}>検索中…</Text>
            )}
          </View>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: SP['4'],
          gap: SP['3'],
          paddingBottom: TABBAR.height + insets.bottom + SP['10'],
        }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl tintColor={C.text2} refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* 公式コミュニティ セクション — クエリ無し */}
        {showOfficialSection && (
          <Animated.View entering={FadeIn.duration(220)} style={{ gap: SP['2'], marginTop: SP['1'] }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: SP['2'] }}>
              <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={[T.h3, { color: C.text, fontWeight: '800' }]}>公式コミュニティ</Text>
                  <View
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 9,
                      backgroundColor: C.accent,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon.check size={11} color="#fff" strokeWidth={3} />
                  </View>
                </View>
                <Text style={[T.small, { color: C.text2 }]}>認証された組織が運営する場所</Text>
              </View>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: SP['3'], paddingVertical: SP['1'], paddingRight: SP['1'] }}
            >
              {officialCommunities.map((c) => (
                <PressableScale
                  key={c.id}
                  onPress={() => router.push(`/community/${c.id}` as never)}
                  haptic="tap"
                  scaleValue={0.96}
                  style={[
                    {
                      width: 160,
                      padding: SP['3'],
                      backgroundColor: C.bg2,
                      borderRadius: R.lg,
                      borderWidth: 1,
                      borderColor: C.accentSoft,
                      gap: SP['2'],
                    },
                    SHADOW.card,
                  ]}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <CommunityIcon
                      iconUrl={c.icon_url}
                      iconEmoji={c.icon_emoji}
                      iconColor={c.icon_color}
                      name={c.name}
                      size={44}
                    />
                    <OfficialBadge size="sm" />
                  </View>
                  <Text style={[T.bodyMd, { color: C.text, fontWeight: '700' }]} numberOfLines={2}>
                    {c.name}
                  </Text>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 3,
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                      backgroundColor: C.bg3,
                      borderRadius: R.full,
                      alignSelf: 'flex-start',
                    }}
                  >
                    <Icon.community size={10} color={C.text3} strokeWidth={2.4} />
                    <Text style={[T.caption, { color: C.text2, fontWeight: '700' }]}>
                      {c.member_count.toLocaleString('ja-JP')}
                    </Text>
                  </View>
                </PressableScale>
              ))}
            </ScrollView>
          </Animated.View>
        )}

        {/* セクションラベル */}
        {!hasQuery && results.length > 0 && (
          <Text
            style={[
              T.smallB,
              {
                color: C.text3,
                letterSpacing: 1.2,
                fontWeight: '700',
                marginTop: SP['2'],
                marginBottom: -SP['1'],
              },
            ]}
          >
            {officialOnly ? '公式コミュニティ一覧' : '人気のコミュニティ'}
          </Text>
        )}

        {loading && results.length === 0 ? (
          Array.from({ length: 4 }).map((_, i) => (
            <View
              key={`skel-community-${i}`}
              style={{
                flexDirection: 'row',
                gap: SP['3'],
                padding: SP['3'],
                backgroundColor: C.bg2,
                borderRadius: R.lg,
                borderWidth: 1,
                borderColor: C.border,
                alignItems: 'center',
              }}
            >
              <SkeletonCircle size={52} />
              <View style={{ flex: 1, gap: 6 }}>
                <Skeleton width="50%" height={14} />
                <Skeleton width="90%" height={12} />
                <Skeleton width="40%" height={10} />
              </View>
            </View>
          ))
        ) : results.length === 0 && !loading ? (
          <View style={{ alignItems: 'center', padding: SP['10'], gap: SP['3'] }}>
            <View style={{
              width: 88, height: 88, borderRadius: 44,
              backgroundColor: C.accentBg,
              alignItems: 'center', justifyContent: 'center',
              borderWidth: 1, borderColor: C.accentSoft,
            }}>
              <Icon.community size={42} color={C.accent} strokeWidth={1.7} />
            </View>
            <Text style={[T.h3, { color: C.text, textAlign: 'center' }]}>
              {query.trim()
                ? '見つかりませんでした'
                : officialOnly
                ? 'まだ公式コミュニティがありません'
                : 'まだコミュニティがありません'}
            </Text>
            <Text style={[T.body, { color: C.text2, textAlign: 'center', maxWidth: 300 }]}>
              {query.trim()
                ? `「${query.trim()}」を含むコミュニティが見つかりません。新規作成しませんか？`
                : officialOnly
                ? '公式認証されたコミュニティはまだありません。フィルタを解除して全コミュニティを表示できます。'
                : '最初のコミュニティを作って仲間を募集してみよう'}
            </Text>
            {officialOnly && !query.trim() ? (
              <PressableScale
                onPress={() => setOfficialOnly(false)}
                haptic="tap"
                hitSlop={10}
                style={{
                  marginTop: SP['2'],
                  paddingHorizontal: SP['5'],
                  paddingVertical: SP['3'],
                  backgroundColor: C.bg3,
                  borderRadius: R.full,
                  borderWidth: 1,
                  borderColor: C.border,
                }}
              >
                <Text style={[T.bodyMd, { color: C.text, fontWeight: '700' }]}>フィルタを解除</Text>
              </PressableScale>
            ) : (
              <PressableScale
                onPress={() => router.push('/community/create' as never)}
                haptic="confirm"
                hitSlop={10}
                style={{
                  marginTop: SP['2'],
                  paddingHorizontal: SP['5'],
                  paddingVertical: SP['3'],
                  backgroundColor: C.accent,
                  borderRadius: R.full,
                  flexDirection: 'row', alignItems: 'center', gap: 6,
                }}
              >
                <Icon.plus size={16} color="#fff" strokeWidth={2.6} />
                <Text style={[T.bodyMd, { color: '#fff', fontWeight: '700' }]}>
                  {query.trim() ? `「${query.trim()}」を作成` : '最初のコミュニティを作る'}
                </Text>
              </PressableScale>
            )}
          </View>
        ) : (
          results.map((c) => {
            const badge = matchLabel(c.matchedBy);
            return (
              <PressableScale
                key={c.id}
                onPress={() => router.push(`/community/${c.id}` as never)}
                haptic="tap"
                scaleValue={0.98}
                style={{
                  flexDirection: 'row',
                  gap: SP['3'],
                  padding: SP['3'],
                  backgroundColor: C.bg2,
                  borderRadius: R.lg,
                  borderWidth: 1,
                  borderColor: C.border,
                  alignItems: 'center',
                }}
              >
                <CommunityIcon
                  iconUrl={c.icon_url}
                  iconEmoji={c.icon_emoji}
                  iconColor={c.icon_color}
                  name={c.name}
                  size={52}
                />
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <Text style={[T.bodyMd, { color: C.text, fontWeight: '700' }]} numberOfLines={1}>
                      {c.name}
                    </Text>
                    {c.is_official && <OfficialBadge size="sm" />}
                    {c.visibility === 'request' && (
                      <Icon.lock size={12} color={C.amber} strokeWidth={2.4} />
                    )}
                    {/* マッチ理由バッジ */}
                    {badge && hasQuery && (
                      <View
                        style={{
                          paddingHorizontal: 6,
                          paddingVertical: 2,
                          backgroundColor: badge.bg,
                          borderRadius: R.sm,
                        }}
                      >
                        <Text style={[T.caption, { color: badge.color, fontWeight: '700', fontSize: 10 }]}>
                          {badge.label}
                          {c.matchedBy === 'synonym' && c.matchedVariant
                            ? ` · ${c.matchedVariant}`
                            : ''}
                        </Text>
                      </View>
                    )}
                  </View>
                  {c.description.length > 0 && (
                    <Text style={[T.small, { color: C.text2 }]} numberOfLines={2}>
                      {c.description}
                    </Text>
                  )}
                  <View style={{ flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                    <View style={{
                      flexDirection: 'row', alignItems: 'center', gap: 3,
                      paddingHorizontal: 8, paddingVertical: 3,
                      backgroundColor: C.bg3, borderRadius: R.full,
                    }}>
                      <Icon.community size={10} color={C.text3} strokeWidth={2.4} />
                      <Text style={[T.caption, { color: C.text2, fontWeight: '700' }]}>
                        {c.member_count.toLocaleString('ja-JP')}
                      </Text>
                    </View>
                    <View style={{
                      flexDirection: 'row', alignItems: 'center', gap: 3,
                      paddingHorizontal: 8, paddingVertical: 3,
                      backgroundColor: C.bg3, borderRadius: R.full,
                    }}>
                      <Icon.bbs size={10} color={C.text3} strokeWidth={2.4} />
                      <Text style={[T.caption, { color: C.text2, fontWeight: '700' }]}>
                        {c.post_count.toLocaleString('ja-JP')}
                      </Text>
                    </View>
                  </View>
                </View>
                <Icon.chevronR size={20} color={C.text3} strokeWidth={2} />
              </PressableScale>
            );
          })
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
