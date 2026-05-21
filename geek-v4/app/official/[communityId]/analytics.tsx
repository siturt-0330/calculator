// ============================================================
// geek-official — 分析ダッシュボード
// ============================================================
// 既存のクエリだけを使ってクライアントサイドで集計を作る簡易版。
// ============================================================
import { useMemo } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { BackButton } from '../../../components/nav/BackButton';
import { PressableScale } from '../../../components/ui/PressableScale';
import { Spinner } from '../../../components/ui/Spinner';
import { EmptyState } from '../../../components/ui/EmptyState';
import { Icon } from '../../../constants/icons';
import { C, R, SP, SHADOW } from '../../../design/tokens';
import { T, FONT } from '../../../design/typography';
import { fetchCommunity } from '../../../lib/api/communities';
import { fetchCommunityPosts } from '../../../lib/api/posts';
import { fetchQnaHistory } from '../../../lib/api/officialCommunities';
import { useAuthStore } from '../../../stores/authStore';

export default function OfficialAnalyticsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams();
  const id = typeof params.communityId === 'string' ? params.communityId : '';
  const userId = useAuthStore((s) => s.user?.id);

  const { data: community, isLoading } = useQuery({
    queryKey: ['community', id],
    queryFn: () => fetchCommunity(id),
    enabled: id.length > 0,
    staleTime: 30_000,
  });
  const isAdmin = !!community && !!userId && community.official_admin_user_id === userId;

  // 大きめに取って TopN を作る
  const { data: postsResult } = useQuery({
    queryKey: ['official-analytics', id, 'posts'],
    queryFn: () => fetchCommunityPosts({ community_id: id, sort: 'new', limit: 100 }),
    enabled: id.length > 0 && isAdmin,
    staleTime: 60_000,
  });

  const { data: questions = [] } = useQuery({
    queryKey: ['official-analytics', id, 'questions'],
    queryFn: () => fetchQnaHistory(id, 100),
    enabled: id.length > 0 && isAdmin,
    staleTime: 60_000,
  });

  const posts = postsResult?.posts ?? [];

  const stats = useMemo(() => {
    const answered = questions.filter((q) => q.status === 'answered').length;
    const noSource = questions.filter((q) => q.status === 'no_source').length;
    const noSourceRatio = questions.length > 0 ? (noSource / questions.length) * 100 : 0;
    return { totalPosts: posts.length, totalQuestions: questions.length, answered, noSource, noSourceRatio };
  }, [posts, questions]);

  const topPosts = useMemo(() => {
    return [...posts].sort((a, b) => b.likes_count - a.likes_count).slice(0, 5);
  }, [posts]);

  const topQuestions = useMemo(() => {
    // 同一文字列の問い合わせ集計
    const map = new Map<string, number>();
    for (const q of questions) {
      const key = q.question.trim().slice(0, 100);
      if (!key) continue;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [questions]);

  if (isLoading || !community) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Spinner size="large" />
      </View>
    );
  }

  if (!isAdmin) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + SP['4'], paddingHorizontal: SP['4'] }}>
        <BackButton />
        <EmptyState icon={Icon.lock} title="権限がありません" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View
        style={{
          paddingTop: insets.top + SP['2'],
          paddingHorizontal: SP['4'],
          paddingBottom: SP['2'],
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['2'],
          borderBottomWidth: 1,
          borderBottomColor: C.border,
        }}
      >
        <BackButton />
        <Text style={[T.h3, { color: C.text, flex: 1 }]}>分析</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + SP['10'] }}
        showsVerticalScrollIndicator={false}
      >
        {/* KPI block */}
        <Animated.View
          entering={FadeInDown.duration(220)}
          style={{ paddingHorizontal: SP['4'], paddingTop: SP['4'], gap: SP['2'] }}
        >
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
            <BigKpi label="メンバー" value={community.member_count} tone="accent" />
            <BigKpi label="総投稿" value={stats.totalPosts} tone="blue" />
            <BigKpi label="Q&A 質問" value={stats.totalQuestions} tone="pink" />
            <BigKpi label="回答済 Q&A" value={stats.answered} tone="green" />
            <BigKpi
              label="ソース無し率"
              value={`${stats.noSourceRatio.toFixed(0)}%`}
              tone={stats.noSourceRatio >= 30 ? 'amber' : 'neutral'}
              hint={`${stats.noSource} / ${stats.totalQuestions}`}
            />
          </View>
        </Animated.View>

        {/* Top liked posts */}
        <SectionHeader label="Top 5 人気投稿" />
        <View style={{ paddingHorizontal: SP['4'], gap: SP['2'] }}>
          {topPosts.length === 0 ? (
            <EmptyBlock label="まだ投稿がありません" emoji="📝" />
          ) : (
            topPosts.map((p, i) => (
              <Animated.View key={p.id} entering={FadeInDown.delay(i * 30).duration(220)}>
                <PressableScale
                  onPress={() => router.push(`/post/${p.id}` as never)}
                  haptic="tap"
                  style={[
                    {
                      padding: SP['3'],
                      backgroundColor: C.bg2,
                      borderRadius: R.lg,
                      borderWidth: 1,
                      borderColor: C.border,
                      flexDirection: 'row',
                      gap: SP['3'],
                      alignItems: 'center',
                    },
                    SHADOW.card,
                  ]}
                >
                  <RankBadge rank={i + 1} />
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={[T.body, { color: C.text }]} numberOfLines={2}>
                      {p.content || '(本文なし)'}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: SP['3'] }}>
                      <MiniStat icon={Icon.heart} value={p.likes_count} />
                      <MiniStat icon={Icon.comment} value={p.comments_count} />
                    </View>
                  </View>
                </PressableScale>
              </Animated.View>
            ))
          )}
        </View>

        {/* Top questions */}
        <SectionHeader label="Top 5 よくある質問" />
        <View style={{ paddingHorizontal: SP['4'], gap: SP['2'] }}>
          {topQuestions.length === 0 ? (
            <EmptyBlock label="まだ質問がありません" emoji="💬" />
          ) : (
            topQuestions.map(([q, count], i) => (
              <Animated.View key={q} entering={FadeInDown.delay(i * 30).duration(220)}>
                <View
                  style={[
                    {
                      padding: SP['3'],
                      backgroundColor: C.bg2,
                      borderRadius: R.lg,
                      borderWidth: 1,
                      borderColor: C.border,
                      flexDirection: 'row',
                      gap: SP['3'],
                      alignItems: 'center',
                    },
                    SHADOW.card,
                  ]}
                >
                  <RankBadge rank={i + 1} />
                  <Text style={[T.body, { color: C.text, flex: 1 }]} numberOfLines={2}>{q}</Text>
                  <View
                    style={{
                      paddingHorizontal: SP['2'],
                      paddingVertical: 2,
                      backgroundColor: C.accentBg,
                      borderRadius: R.full,
                      borderWidth: 1,
                      borderColor: C.accent + '55',
                    }}
                  >
                    <Text style={{ fontSize: 11, color: C.accentLight, fontWeight: '800' }}>×{count}</Text>
                  </View>
                </View>
              </Animated.View>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['2'],
        paddingHorizontal: SP['4'],
        paddingTop: SP['6'],
        paddingBottom: SP['2'],
      }}
    >
      <Text style={{ fontSize: 10, fontWeight: '800', color: C.text3, letterSpacing: 1.2, textTransform: 'uppercase' }}>
        {label}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: C.border }} />
    </View>
  );
}

type Tone = 'neutral' | 'accent' | 'blue' | 'green' | 'amber' | 'pink';
const TONE: Record<Tone, { fg: string; bg: string; border: string }> = {
  neutral: { fg: C.text,        bg: C.bg2,      border: C.border },
  accent:  { fg: C.accentLight, bg: C.accentBg, border: C.accent + '55' },
  blue:    { fg: C.blue,        bg: C.blueBg,   border: C.blue + '55' },
  green:   { fg: C.green,       bg: C.greenBg,  border: C.green + '55' },
  amber:   { fg: C.amber,       bg: C.amberBg,  border: C.amber + '55' },
  pink:    { fg: C.pink,        bg: C.pinkBg,   border: C.pink + '55' },
};

function BigKpi({
  label, value, tone, hint,
}: { label: string; value: number | string; tone: Tone; hint?: string }) {
  const p = TONE[tone];
  return (
    <View
      style={[
        {
          flexBasis: '48%',
          flexGrow: 1,
          minWidth: 140,
          backgroundColor: p.bg,
          borderRadius: R.lg,
          borderWidth: 1,
          borderColor: p.border,
          padding: SP['3'],
          gap: 4,
          overflow: 'hidden',
        },
        SHADOW.card,
      ]}
    >
      <LinearGradient
        colors={[p.fg + '14', 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '70%' }}
        pointerEvents="none"
      />
      <Text
        style={{
          fontFamily: FONT.uiBold,
          fontSize: 28,
          lineHeight: 32,
          color: p.fg,
          fontWeight: '800',
          letterSpacing: -0.5,
        }}
        numberOfLines={1}
      >
        {typeof value === 'number' ? value.toLocaleString('ja-JP') : value}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SP['2'] }}>
        <Text
          style={{
            fontSize: 10,
            color: C.text3,
            fontWeight: '700',
            letterSpacing: 0.6,
            textTransform: 'uppercase',
            flexShrink: 1,
          }}
          numberOfLines={1}
        >
          {label}
        </Text>
        {hint && <Text style={{ fontSize: 9, color: C.text4, fontWeight: '600' }}>{hint}</Text>}
      </View>
    </View>
  );
}

function RankBadge({ rank }: { rank: number }) {
  const palette =
    rank === 1 ? { fg: '#FFD64D', bg: '#3a2f10', border: '#FFD64D55' } :
    rank === 2 ? { fg: '#D8D8D8', bg: '#2a2a2a', border: '#D8D8D855' } :
    rank === 3 ? { fg: '#CD7F32', bg: '#2a1a10', border: '#CD7F3255' } :
                 { fg: C.text2, bg: C.bg3, border: C.border };
  return (
    <View
      style={{
        width: 28,
        height: 28,
        borderRadius: 14,
        backgroundColor: palette.bg,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: palette.border,
      }}
    >
      <Text style={{ fontSize: 13, fontWeight: '800', color: palette.fg }}>{rank}</Text>
    </View>
  );
}

function MiniStat({ icon: I, value }: { icon: typeof Icon.heart; value: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <I size={12} color={C.text3} strokeWidth={2.2} />
      <Text style={[T.caption, { color: C.text3, fontWeight: '700' }]}>{value}</Text>
    </View>
  );
}

function EmptyBlock({ label, emoji }: { label: string; emoji: string }) {
  return (
    <View
      style={{
        padding: SP['6'],
        alignItems: 'center',
        gap: SP['2'],
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
      }}
    >
      <Text style={{ fontSize: 28 }}>{emoji}</Text>
      <Text style={[T.small, { color: C.text3 }]}>{label}</Text>
    </View>
  );
}
