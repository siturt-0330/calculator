// =============================================================================
// RightSearchPanel — デスクトップ Web の常時表示 X 風右カラム
// -----------------------------------------------------------------------------
// (tabs)/_layout.tsx で width >= 1100px のときだけ Tabs の右に置く固定カラム。
// モバイルでは描画されない (親で gating)。
//
// 構成:
//   - 検索バー (Pressable + 模した TextInput 風カード)
//     → タップで /(tabs)/search に遷移 (本物の検索画面を開く)
//   - トレンドタグ section (TrendingRow と同 API で簡易版を描画)
//   - 「検索画面を開く」誘導
// =============================================================================

import { View, Text, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Search as SearchIcon, TrendingUp } from 'lucide-react-native';

import { PressableScale } from '../ui/PressableScale';
import { fetchTrendingTags } from '../../lib/api/trending';
import { useTagCooccurStore } from '../../stores/tagCooccurStore';
import { useTheme } from '../../hooks/useColors';
import { R, SP } from '../../design/tokens';
import { T } from '../../design/typography';

export function RightSearchPanel() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { C } = useTheme();

  // TrendingRow と同じ key / fn を使い cache 共有 (二重 fetch 回避)。
  const cooccur = useTagCooccurStore((s) => s.cooccur);
  const cooccurHydrated = useTagCooccurStore((s) => s.hydrated);
  const cooccurHasData = cooccurHydrated && Object.keys(cooccur).length > 0;
  const cooccurKey = cooccurHasData ? 'div' : 'plain';
  const { data: trending = [] } = useQuery({
    queryKey: ['trending-tags', cooccurKey],
    queryFn: () =>
      fetchTrendingTags({
        limit: 10,
        ...(cooccurHasData ? { diversify: true, cooccur } : {}),
      }),
    staleTime: 5 * 60 * 1000,
    refetchOnMount: false,
  });

  const openSearch = () => router.push('/(tabs)/search' as never);

  return (
    <View
      style={{
        width: 340,
        height: '100%',
        backgroundColor: C.bg,
        borderLeftWidth: 1,
        borderLeftColor: C.divider,
        paddingTop: insets.top + SP['3'],
        paddingBottom: insets.bottom + SP['3'],
      }}
    >
      {/* 検索バー (本物の検索画面への入り口) */}
      <View style={{ paddingHorizontal: SP['4'], paddingBottom: SP['3'] }}>
        <Pressable
          onPress={openSearch}
          accessibilityRole="button"
          accessibilityLabel="検索を開く"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: SP['2'],
            paddingHorizontal: SP['3'],
            height: 42,
            borderRadius: R.full,
            backgroundColor: C.bg2,
            borderWidth: 1,
            borderColor: C.border,
          }}
        >
          <SearchIcon size={16} color={C.text3} strokeWidth={2.2} />
          <Text style={[T.body, { color: C.text3, flex: 1 }]} numberOfLines={1}>
            検索
          </Text>
        </Pressable>
      </View>

      {/* トレンド section */}
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        <View
          style={{
            marginHorizontal: SP['4'],
            paddingVertical: SP['3'],
            paddingHorizontal: SP['4'],
            borderRadius: R.lg,
            backgroundColor: C.bg2,
            borderWidth: 1,
            borderColor: C.divider,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: SP['2'],
              marginBottom: SP['3'],
            }}
          >
            <TrendingUp size={16} color={C.text2} strokeWidth={2.2} />
            <Text style={[T.smallB, { color: C.text }]}>いま盛り上がっているタグ</Text>
          </View>

          {trending.length === 0 ? (
            <Text style={[T.caption, { color: C.text3 }]}>まだトレンドがありません</Text>
          ) : (
            <View style={{ gap: SP['2'] }}>
              {trending.slice(0, 8).map((tag, i) => (
                <PressableScale
                  key={tag.name}
                  onPress={() => router.push(`/tag/${encodeURIComponent(tag.name)}` as never)}
                  haptic="tap"
                  accessibilityRole="button"
                  accessibilityLabel={`#${tag.name}`}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingVertical: SP['2'],
                    gap: SP['2'],
                  }}
                >
                  <Text style={[T.caption, { color: C.text4, minWidth: 18 }]}>
                    {i + 1}
                  </Text>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[T.smallB, { color: C.text }]} numberOfLines={1}>
                      #{tag.name}
                    </Text>
                    {tag.postCount > 0 ? (
                      <Text style={[T.caption, { color: C.text3 }]} numberOfLines={1}>
                        {tag.postCount.toLocaleString()} 投稿 · {tag.window}
                      </Text>
                    ) : null}
                  </View>
                </PressableScale>
              ))}
            </View>
          )}

          <PressableScale
            onPress={openSearch}
            haptic="tap"
            accessibilityRole="button"
            accessibilityLabel="もっと見る"
            style={{
              marginTop: SP['2'],
              paddingTop: SP['2'],
              borderTopWidth: 1,
              borderTopColor: C.divider,
            }}
          >
            <Text style={[T.smallM, { color: C.accent }]}>もっと見る</Text>
          </PressableScale>
        </View>
      </ScrollView>
    </View>
  );
}
