// ============================================================
// RecommendedCommunities — 検索/ディスカバリータブの「おすすめコミュニティ」
// ------------------------------------------------------------
// discoverCommunities() の結果を member_count desc で並び替えて
// 横スクロール表示。120x140 カードに avatar + name + member chip。
// - tap → /community/[id]
// - 1 RTT + React Query staleTime 5 min (コミュ情報は変わりにくい)
// ============================================================
import { useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useColors } from '../../hooks/useColors';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';
import { R, SP, SHADOW } from '../../design/tokens';
import { T } from '../../design/typography';
import { discoverCommunities, type Community } from '../../lib/api/communities';
import { thumbedUrl } from '../../lib/utils/imageUrl';

// iOS-native: 「もっと繋がっているように」 = カード枠を外して
// 純粋な avatar + label 並びにする (Stories / Friends 行のような密度)
const COLUMN_WIDTH = 76;
const AVATAR_SIZE = 56;
const LIMIT = 20;

export function RecommendedCommunities() {
  const C = useColors();
  const router = useRouter();

  const { data, isLoading } = useQuery({
    queryKey: ['recommended-communities', LIMIT],
    queryFn: () => discoverCommunities({ limit: LIMIT }),
    staleTime: 5 * 60_000,
  });

  // member_count desc でソート (sentinel: discoverCommunities は別ロジックで返す)
  const sorted = useMemo(() => {
    const list = (data ?? []).slice();
    list.sort((a, b) => (b.member_count ?? 0) - (a.member_count ?? 0));
    return list;
  }, [data]);

  if (isLoading && sorted.length === 0) {
    // skeleton: avatar + label の 4 個分
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
          <Icon.community size={14} color={C.text3} strokeWidth={2.2} />
          <Text style={[T.smallM, { color: C.text3, letterSpacing: 0.5 }]}>
            おすすめコミュニティ
          </Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: SP['3'], paddingHorizontal: SP['4'] }}
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <View key={`sk-${i}`} style={{ width: COLUMN_WIDTH, alignItems: 'center', gap: 8 }}>
              <View
                style={{
                  width: AVATAR_SIZE,
                  height: AVATAR_SIZE,
                  borderRadius: AVATAR_SIZE / 2,
                  backgroundColor: C.bg2,
                  borderWidth: 1,
                  borderColor: C.border,
                  opacity: 0.6,
                }}
              />
              <View
                style={{
                  width: 48,
                  height: 10,
                  borderRadius: R.sm,
                  backgroundColor: C.bg2,
                  opacity: 0.6,
                }}
              />
            </View>
          ))}
        </ScrollView>
        <ActivityIndicator color={C.accent} style={{ position: 'absolute', top: 36, alignSelf: 'center' }} />
      </View>
    );
  }

  if (sorted.length === 0) return null;

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
        <Icon.community size={14} color={C.text3} strokeWidth={2.2} />
        <Text style={[T.smallM, { color: C.text3, letterSpacing: 0.5 }]}>
          おすすめコミュニティ
        </Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          gap: SP['3'],
          paddingHorizontal: SP['4'],
          paddingVertical: 2,
        }}
      >
        {sorted.map((c) => (
          <CommunityCard
            key={c.id}
            community={c}
            onPress={() => router.push(`/community/${c.id}` as never)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function CommunityCard({
  community,
  onPress,
}: {
  community: Community;
  onPress: () => void;
}) {
  const C = useColors();
  const thumb = useMemo(
    () => (community.icon_url ? thumbedUrl(community.icon_url, 240) : null),
    [community.icon_url],
  );
  const thumbSource = useMemo(() => (thumb ? { uri: thumb } : null), [thumb]);

  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      scaleValue={0.92}
      style={{
        width: COLUMN_WIDTH,
        alignItems: 'center',
        gap: 8,
      }}
      accessibilityLabel={`コミュニティを開く: ${community.name}`}
    >
      {/* 円アバター — 枠を外して "人と繋がっているような" 表現に */}
      <View
        style={[
          {
            width: AVATAR_SIZE,
            height: AVATAR_SIZE,
            borderRadius: AVATAR_SIZE / 2,
            backgroundColor: community.icon_url ? C.bg3 : community.icon_color,
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            // iOS-native: 肌身の subtle ring (border) で「球体感」を出す
            borderWidth: 1.5,
            borderColor: C.border2,
          },
          SHADOW.xs,
        ]}
      >
        {thumbSource ? (
          <ExpoImage
            source={thumbSource}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={community.icon_url ?? community.id}
            transition={120}
          />
        ) : (
          <Text style={{ fontSize: 26 }}>{community.icon_emoji}</Text>
        )}
      </View>

      {/* name — 11pt (iOS-native の section label と同密度) */}
      <Text
        style={[
          T.caption,
          {
            color: C.text,
            textAlign: 'center',
            fontWeight: '600',
            letterSpacing: -0.1,
          },
        ]}
        numberOfLines={2}
      >
        {community.name}
      </Text>

      {/* member count — 軽量に (chip ではなく数字 + アイコン直書き) */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 3,
          marginTop: -4,
        }}
      >
        <Icon.friends size={9} color={C.text3} strokeWidth={2.2} />
        <Text style={{ fontSize: 10, color: C.text3, fontWeight: '700' }}>
          {community.member_count.toLocaleString('ja-JP')}
        </Text>
      </View>
    </PressableScale>
  );
}
