// ============================================================
// geek-official — コミュニティ管理ダッシュボード
// ============================================================
import { useMemo } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import type { LucideIcon } from 'lucide-react-native';
import { BackButton } from '../../../components/nav/BackButton';
import { PressableScale } from '../../../components/ui/PressableScale';
import { CommunityIcon } from '../../../components/ui/CommunityIcon';
import { Spinner } from '../../../components/ui/Spinner';
import { EmptyState } from '../../../components/ui/EmptyState';
import { Icon } from '../../../constants/icons';
import { C, R, SP, SHADOW } from '../../../design/tokens';
import { T, FONT } from '../../../design/typography';
import { fetchCommunity } from '../../../lib/api/communities';
import { fetchCommunityPosts } from '../../../lib/api/posts';
import {
  fetchQnaDocuments,
  fetchQnaHistory,
  fetchCalendarEvents,
} from '../../../lib/api/officialCommunities';
import { sanitizeUrl } from '../../../lib/sanitize';
import { formatRelative } from '../../../lib/utils/date';
import { useAuthStore } from '../../../stores/authStore';

type Tone = 'neutral' | 'accent' | 'blue' | 'green' | 'amber' | 'pink';
const TONE: Record<Tone, { fg: string; bg: string; border: string }> = {
  neutral: { fg: C.text,        bg: C.bg2,      border: C.border },
  accent:  { fg: C.accentLight, bg: C.accentBg, border: C.accent + '55' },
  blue:    { fg: C.blue,        bg: C.blueBg,   border: C.blue + '55' },
  green:   { fg: C.green,       bg: C.greenBg,  border: C.green + '55' },
  amber:   { fg: C.amber,       bg: C.amberBg,  border: C.amber + '55' },
  pink:    { fg: C.pink,        bg: C.pinkBg,   border: C.pink + '55' },
};

export default function OfficialDashboardScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams();
  const communityId = typeof params.communityId === 'string' ? params.communityId : '';
  const userId = useAuthStore((s) => s.user?.id);

  const { data: community, isLoading } = useQuery({
    queryKey: ['community', communityId],
    queryFn: () => fetchCommunity(communityId),
    enabled: communityId.length > 0,
    staleTime: 30_000,
  });

  // 投稿一覧 — KPI 計算 + Recent feed の元データ
  const { data: postsResult } = useQuery({
    queryKey: ['official-dashboard', communityId, 'posts'],
    queryFn: () => fetchCommunityPosts({ community_id: communityId, sort: 'new', limit: 30 }),
    enabled: communityId.length > 0,
    staleTime: 30_000,
  });

  const { data: docs = [] } = useQuery({
    queryKey: ['official-dashboard', communityId, 'docs'],
    queryFn: () => fetchQnaDocuments(communityId),
    enabled: communityId.length > 0,
    staleTime: 30_000,
  });

  const { data: questions = [] } = useQuery({
    queryKey: ['official-dashboard', communityId, 'qna-history'],
    queryFn: () => fetchQnaHistory(communityId, 5),
    enabled: communityId.length > 0,
    staleTime: 30_000,
  });

  const { data: events = [] } = useQuery({
    queryKey: ['official-dashboard', communityId, 'events'],
    queryFn: () => fetchCalendarEvents(communityId),
    enabled: communityId.length > 0,
    staleTime: 30_000,
  });

  const posts = useMemo(() => postsResult?.posts ?? [], [postsResult]);

  const thisWeekPosts = useMemo(() => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return posts.filter((p) => new Date(p.created_at).getTime() >= sevenDaysAgo).length;
  }, [posts]);

  const recentPosts = useMemo(() => posts.slice(0, 5), [posts]);
  const recentQuestions = useMemo(() => questions.slice(0, 3), [questions]);

  // gating — 念のため (layout でも見ているが直リンク対策)
  const isAdmin = !!community && !!userId && community.official_admin_user_id === userId;

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
        <EmptyState
          icon={Icon.lock}
          title="権限がありません"
          message="このコミュニティの公式管理者ではないため、ダッシュボードを開けません"
        />
      </View>
    );
  }

  const safeIcon = community.icon_url ? sanitizeUrl(community.icon_url) : null;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* ── Header ────────────────────── */}
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
        <CommunityIcon
          iconUrl={safeIcon}
          iconEmoji={community.icon_emoji}
          iconColor={community.icon_color}
          name={community.name}
          size={32}
        />
        <Text style={[T.h3, { color: C.text, flex: 1 }]} numberOfLines={1}>{community.name}</Text>
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
          <Text style={{ fontSize: 9, color: C.accentLight, fontWeight: '800', letterSpacing: 0.5 }}>公式</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + SP['10'] }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── KPI Grid (2x3) ──────────── */}
        <Animated.View entering={FadeIn.duration(220)} style={{ paddingHorizontal: SP['4'], paddingTop: SP['4'] }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
            <Kpi label="メンバー"          value={community.member_count} tone="accent" />
            <Kpi label="総投稿"            value={community.post_count}   tone="blue" />
            <Kpi label="今週の投稿"        value={thisWeekPosts}          tone="green" hint="last 7d" />
            <Kpi label="Q&A 質問"          value={questions.length}       tone="pink" />
            <Kpi label="ナレッジ"          value={docs.length}            tone="amber" />
            <Kpi label="イベント"          value={events.length}          tone="neutral" />
          </View>
        </Animated.View>

        {/* ── Quick actions (2x3 grid) ─── */}
        <SectionHeader label="クイックアクション" />
        <View style={{ paddingHorizontal: SP['4'] }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
            <ActionTile
              icon={Icon.edit}
              label="投稿を書く"
              onPress={() => router.push(`/official/${communityId}/post` as never)}
              tone="accent"
              delay={0}
            />
            {/* ナレッジ管理は廃止 (2026-05) — Q&A 機能ごと撤去 */}
            <ActionTile
              icon={Icon.calendar}
              label="イベント管理"
              onPress={() => router.push(`/official/${communityId}/events` as never)}
              tone="blue"
              delay={40}
            />
            <ActionTile
              icon={Icon.map}
              label="聖地管理"
              onPress={() => router.push(`/official/${communityId}/spots` as never)}
              tone="green"
              delay={120}
            />
            <ActionTile
              icon={Icon.sparkles}
              label="分析"
              onPress={() => router.push(`/official/${communityId}/analytics` as never)}
              tone="pink"
              delay={160}
            />
            <ActionTile
              icon={Icon.settings}
              label="コミュ詳細"
              onPress={() => router.push(`/community/${communityId}` as never)}
              tone="neutral"
              delay={200}
            />
          </View>
        </View>

        {/* ── Recent posts ─────────────── */}
        <SectionHeader
          label="最近の投稿"
          rightLabel="すべて見る →"
          onRight={() => router.push(`/community/${communityId}` as never)}
        />
        <View style={{ paddingHorizontal: SP['4'], gap: SP['2'] }}>
          {recentPosts.length === 0 ? (
            <EmptyBlock label="まだ投稿はありません" emoji="📝" />
          ) : (
            recentPosts.map((p, i) => (
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
                      gap: 6,
                    },
                    SHADOW.card,
                  ]}
                >
                  <Text style={[T.body, { color: C.text }]} numberOfLines={3}>
                    {p.content || '(本文なし)'}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['3'] }}>
                    <Stat icon={Icon.heart} value={p.likes_count} />
                    <Stat icon={Icon.comment} value={p.comments_count} />
                    <View style={{ flex: 1 }} />
                    <Text style={[T.caption, { color: C.text4 }]}>{formatRelative(p.created_at)}</Text>
                  </View>
                </PressableScale>
              </Animated.View>
            ))
          )}
        </View>

        {/* ── Recent Q&A ────────────── */}
        <SectionHeader label="最近の Q&A" />
        <View style={{ paddingHorizontal: SP['4'], gap: SP['2'] }}>
          {recentQuestions.length === 0 ? (
            <EmptyBlock label="まだ質問はありません" emoji="💬" />
          ) : (
            recentQuestions.map((q, i) => (
              <Animated.View key={q.id} entering={FadeInDown.delay(i * 30).duration(220)}>
                <View
                  style={[
                    {
                      padding: SP['3'],
                      backgroundColor: C.bg2,
                      borderRadius: R.lg,
                      borderWidth: 1,
                      borderColor: C.border,
                      gap: 6,
                    },
                    SHADOW.card,
                  ]}
                >
                  <View style={{ flexDirection: 'row', gap: SP['2'], alignItems: 'center' }}>
                    <View
                      style={{
                        paddingHorizontal: SP['2'],
                        paddingVertical: 1,
                        borderRadius: R.sm,
                        backgroundColor:
                          q.status === 'answered' ? C.greenBg :
                          q.status === 'no_source' ? C.amberBg : C.bg3,
                        borderWidth: 1,
                        borderColor:
                          (q.status === 'answered' ? C.green :
                          q.status === 'no_source' ? C.amber : C.text3) + '55',
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 9,
                          fontWeight: '700',
                          color:
                            q.status === 'answered' ? C.green :
                            q.status === 'no_source' ? C.amber : C.text3,
                        }}
                      >
                        {q.status === 'answered' ? '回答済' :
                         q.status === 'no_source' ? 'ソース無' : '保留'}
                      </Text>
                    </View>
                    <Text style={[T.caption, { color: C.text4, marginLeft: 'auto' }]}>
                      {formatRelative(q.asked_at)}
                    </Text>
                  </View>
                  <Text style={[T.bodyB, { color: C.text }]} numberOfLines={2}>
                    {q.question}
                  </Text>
                </View>
              </Animated.View>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

// ============================================================
// 内部コンポーネント
// ============================================================
function SectionHeader({
  label, rightLabel, onRight,
}: { label: string; rightLabel?: string; onRight?: () => void }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['2'],
        paddingHorizontal: SP['4'],
        paddingTop: SP['5'],
        paddingBottom: SP['2'],
      }}
    >
      <Text style={{ fontSize: 10, fontWeight: '800', color: C.text3, letterSpacing: 1.2, textTransform: 'uppercase' }}>
        {label}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: C.border }} />
      {rightLabel && onRight && (
        <PressableScale onPress={onRight} haptic="tap" hitSlop={6}>
          <Text style={[T.caption, { color: C.accentLight, fontWeight: '700' }]}>{rightLabel}</Text>
        </PressableScale>
      )}
    </View>
  );
}

function Kpi({
  label, value, tone, hint,
}: { label: string; value: number; tone: Tone; hint?: string }) {
  const p = TONE[tone];
  return (
    <View
      style={[
        {
          flexBasis: '31%',
          flexGrow: 1,
          minWidth: 100,
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
          fontSize: 24,
          lineHeight: 28,
          color: p.fg,
          fontWeight: '800',
          letterSpacing: -0.5,
        }}
        numberOfLines={1}
      >
        {value.toLocaleString('ja-JP')}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text
          style={{
            fontSize: 10,
            color: C.text3,
            fontWeight: '700',
            letterSpacing: 0.6,
            textTransform: 'uppercase',
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

function ActionTile({
  icon: I, label, onPress, tone, delay,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  tone: Tone;
  delay: number;
}) {
  const p = TONE[tone];
  return (
    <Animated.View entering={FadeInDown.delay(delay).duration(220)} style={{ flexBasis: '31%', flexGrow: 1, minWidth: 100 }}>
      <PressableScale
        onPress={onPress}
        haptic="tap"
        style={[
          {
            paddingVertical: SP['4'],
            paddingHorizontal: SP['3'],
            backgroundColor: p.bg,
            borderRadius: R.lg,
            borderWidth: 1,
            borderColor: p.border,
            alignItems: 'center',
            gap: 6,
          },
          SHADOW.card,
        ]}
      >
        <I size={24} color={p.fg} strokeWidth={2.2} />
        <Text style={[T.smallB, { color: p.fg, fontSize: 12, textAlign: 'center' }]} numberOfLines={1}>
          {label}
        </Text>
      </PressableScale>
    </Animated.View>
  );
}

function Stat({ icon: I, value }: { icon: LucideIcon; value: number }) {
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
