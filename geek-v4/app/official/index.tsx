// ============================================================
// geek-official — 公式コミュ管理 / セレクター
// ============================================================
// 自分が official_admin の community を一覧表示し、選ぶと
// /official/[communityId] のダッシュボードに遷移する。
// ============================================================
import { View, Text, ScrollView, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { BackButton } from '../../components/nav/BackButton';
import { PressableScale } from '../../components/ui/PressableScale';
import { EmptyState } from '../../components/ui/EmptyState';
import { Icon } from '../../constants/icons';
import { C, R, SP, SHADOW } from '../../design/tokens';
import { T, FONT, LOGO_FONT, LOGO_FONT_WEIGHT } from '../../design/typography';
import { fetchMyOfficialCommunities } from '../../lib/api/officialCommunities';
import { sanitizeUrl } from '../../lib/sanitize';
import { formatRelative } from '../../lib/utils/date';
import type { Community } from '../../lib/api/communities';
import { useAuthStore } from '../../stores/authStore';

export default function OfficialSelectorScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id);

  const { data: communities = [] } = useQuery<Community[]>({
    queryKey: ['my-official-communities', userId],
    queryFn: fetchMyOfficialCommunities,
    enabled: !!userId,
    staleTime: 60_000,
  });

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* ── Header ─────────────────────────── */}
      <View
        style={{
          paddingTop: insets.top + SP['2'],
          paddingHorizontal: SP['4'],
          paddingBottom: SP['3'],
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['2'],
        }}
      >
        <BackButton />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingBottom: insets.bottom + SP['10'],
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Title block ──────────────────────── */}
        <Animated.View
          entering={FadeIn.duration(300)}
          style={{ paddingHorizontal: SP['4'], paddingTop: SP['1'], paddingBottom: SP['5'] }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'], marginBottom: 4 }}>
            <Text
              style={{
                fontFamily: LOGO_FONT,
                fontWeight: LOGO_FONT_WEIGHT,
                fontSize: 32,
                lineHeight: 38,
                letterSpacing: -0.8,
                color: C.text,
              }}
            >
              Geek Official
            </Text>
            <View
              style={{
                paddingHorizontal: SP['2'],
                paddingVertical: 2,
                backgroundColor: C.accentBg,
                borderRadius: R.sm,
                borderWidth: 1,
                borderColor: C.accent + '66',
              }}
            >
              <Text
                style={{
                  fontSize: 10,
                  color: C.accentLight,
                  fontWeight: '800',
                  letterSpacing: 0.6,
                }}
              >
                ADMIN
              </Text>
            </View>
          </View>
          <Text style={[T.caption, { color: C.text3 }]} numberOfLines={2}>
            公式コミュニティの管理ダッシュボード · 投稿 / ナレッジ / イベント / 聖地 / 分析
          </Text>
        </Animated.View>

        {/* ── Community cards ──────────────────── */}
        {communities.length === 0 ? (
          <EmptyState
            icon={Icon.shield}
            title="公式コミュニティを持っていません"
            message="公式コミュニティに承認されると、このパネルから管理できるようになります。"
            actionLabel="コミュニティを探す"
            onAction={() => router.push('/community/discover' as never)}
            tone="accent"
          />
        ) : (
          <View style={{ paddingHorizontal: SP['4'], gap: SP['3'] }}>
            {communities.map((c, i) => (
              <Animated.View key={c.id} entering={FadeInDown.delay(i * 50).duration(220)}>
                <CommunityCard
                  community={c}
                  onPress={() => router.push(`/official/${c.id}` as never)}
                />
              </Animated.View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function CommunityCard({ community, onPress }: { community: Community; onPress: () => void }) {
  const safeIconUrl = community.icon_url ? sanitizeUrl(community.icon_url) : null;
  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      style={[
        {
          padding: SP['4'],
          backgroundColor: C.bg2,
          borderRadius: R.xl,
          borderWidth: 1,
          borderColor: C.accent + '33',
          overflow: 'hidden',
        },
        SHADOW.card,
      ]}
    >
      <LinearGradient
        colors={[C.accent + '14', 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '70%' }}
        pointerEvents="none"
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['3'] }}>
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: R.lg,
            backgroundColor: safeIconUrl ? C.bg3 : community.icon_color,
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: C.border,
          }}
        >
          {safeIconUrl ? (
            <Image source={{ uri: safeIconUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          ) : (
            <Text style={{ fontSize: 32 }}>{community.icon_emoji}</Text>
          )}
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={[T.h3, { color: C.text, flexShrink: 1 }]} numberOfLines={1}>
              {community.name}
            </Text>
            <View
              style={{
                paddingHorizontal: SP['2'],
                paddingVertical: 1,
                backgroundColor: C.accentBg,
                borderRadius: R.sm,
                borderWidth: 1,
                borderColor: C.accent + '55',
              }}
            >
              <Text style={{ fontSize: 9, color: C.accentLight, fontWeight: '800', letterSpacing: 0.5 }}>
                公式
              </Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: SP['4'] }}>
            <MetaStat label="メンバー" value={community.member_count} />
            <MetaStat label="投稿" value={community.post_count} />
          </View>
          {community.last_post_at && (
            <Text style={[T.caption, { color: C.text4 }]} numberOfLines={1}>
              最終投稿 · {formatRelative(community.last_post_at)}
            </Text>
          )}
        </View>
        <Icon.chevronR size={20} color={C.text3} strokeWidth={2.2} />
      </View>
    </PressableScale>
  );
}

function MetaStat({ label, value }: { label: string; value: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
      <Text style={{ fontFamily: FONT.uiBold, fontSize: 14, color: C.text, fontWeight: '700' }}>
        {value.toLocaleString('ja-JP')}
      </Text>
      <Text style={[T.caption, { color: C.text3 }]}>{label}</Text>
    </View>
  );
}
