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
import { Search as SearchIcon, TrendingUp, Trophy } from 'lucide-react-native';

import { PressableScale } from '../ui/PressableScale';
import { fetchTrendingCommunities } from '../../lib/api/trending';
import { CommunityIcon } from '../ui/CommunityIcon';
import { useOpenContests } from '../../hooks/useContests';
import { contestStatus } from '../contest/ContestCard';
import { useFeedStore } from '../../stores/feedStore';
import { useTheme } from '../../hooks/useColors';
import { R, SP } from '../../design/tokens';
import { T } from '../../design/typography';

export function RightSearchPanel() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { C } = useTheme();

  // ★ 2026-06-13: デスクトップ右カラムも、モバイルの TrendingRow と同じ
  //   「盛り上がってるコミュニティ」に統一 (旧: トレンドタグ)。同一 queryKey
  //   ['trending-communities'] で TrendingRow と cache を共有し二重 fetch を避ける。
  const { data: trending = [] } = useQuery({
    queryKey: ['trending-communities'],
    queryFn: () => fetchTrendingCommunities(8),
    staleTime: 5 * 60 * 1000,
    refetchOnMount: false,
  });

  // 盛り上がってるコンテスト (開催中) — ContestList と同じ useOpenContests で cache 共有。
  const { data: openContests = [] } = useOpenContests();

  const openSearch = () => router.push('/(tabs)/search' as never);
  // コンテスト一覧へ = feed の scope を 'closed'(=ContestList) に切替えて遷移 (LeftSidebar と同機構)。
  //   ?scope=contest を付けて URL に view を載せ、ブックマーク / 共有 / ブラウザ戻るを機能させる。
  const openContestList = () => {
    useFeedStore.getState().setScope('closed');
    router.push('/(tabs)/feed?scope=contest' as never);
  };

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
            <Text style={[T.smallB, { color: C.text }]}>盛り上がってるコミュニティ</Text>
          </View>

          {trending.length === 0 ? (
            <Text style={[T.caption, { color: C.text3 }]}>まだトレンドがありません</Text>
          ) : (
            <View style={{ gap: SP['2'] }}>
              {trending.slice(0, 8).map(({ community: c, postCount }, i) => (
                <PressableScale
                  key={c.id}
                  onPress={() => router.push(`/community/${c.id}` as never)}
                  haptic="tap"
                  accessibilityRole="button"
                  accessibilityLabel={`コミュニティ ${c.name} を開く (直近 ${postCount} 件)`}
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
                  <CommunityIcon
                    size={32}
                    iconUrl={c.icon_url}
                    iconEmoji={c.icon_emoji}
                    iconColor={c.icon_color}
                    name={c.name}
                  />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[T.smallB, { color: C.text }]} numberOfLines={1}>
                      {c.name}
                    </Text>
                    {postCount > 0 ? (
                      <Text style={[T.caption, { color: C.text3 }]} numberOfLines={1}>
                        直近 {postCount.toLocaleString()} 投稿
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

        {/* ===== 盛り上がってるコンテスト (コミュニティの下) ===== */}
        <View
          style={{
            marginHorizontal: SP['4'],
            marginTop: SP['3'],
            paddingVertical: SP['3'],
            paddingHorizontal: SP['4'],
            borderRadius: R.lg,
            backgroundColor: C.bg2,
            borderWidth: 1,
            borderColor: C.divider,
          }}
        >
          <View
            style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'], marginBottom: SP['3'] }}
          >
            <Trophy size={16} color={C.accent} strokeWidth={2.2} />
            <Text style={[T.smallB, { color: C.text }]}>盛り上がってるコンテスト</Text>
          </View>

          {openContests.length === 0 ? (
            <Text style={[T.caption, { color: C.text3 }]}>開催中のコンテストはありません</Text>
          ) : (
            <View style={{ gap: SP['2'] }}>
              {openContests.slice(0, 5).map((c, i) => {
                const st = contestStatus(c, C.accent, C.text3);
                return (
                  <PressableScale
                    key={c.id}
                    onPress={() => router.push(`/contest/${c.id}` as never)}
                    haptic="tap"
                    accessibilityRole="button"
                    accessibilityLabel={`コンテスト ${c.title} を開く`}
                    style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: SP['2'], gap: SP['2'] }}
                  >
                    <Text style={[T.caption, { color: C.text4, minWidth: 18 }]}>{i + 1}</Text>
                    <View
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: R.full,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: C.accent + '1f',
                      }}
                    >
                      <Trophy size={15} color={C.accent} strokeWidth={2.2} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[T.smallB, { color: C.text }]} numberOfLines={1}>
                        {c.title}
                      </Text>
                      <Text style={[T.caption, { color: st.tone }]} numberOfLines={1}>
                        {st.text}
                      </Text>
                    </View>
                  </PressableScale>
                );
              })}
            </View>
          )}

          <PressableScale
            onPress={openContestList}
            haptic="tap"
            accessibilityRole="button"
            accessibilityLabel="コンテストをもっと見る"
            style={{ marginTop: SP['2'], paddingTop: SP['2'], borderTopWidth: 1, borderTopColor: C.divider }}
          >
            <Text style={[T.smallM, { color: C.accent }]}>もっと見る</Text>
          </PressableScale>
        </View>
      </ScrollView>
    </View>
  );
}
