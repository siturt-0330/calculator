import { useMemo } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { BackButton } from '@/components/nav/BackButton';
import { PressableScale } from '@/components/ui/PressableScale';
import { Spinner } from '@/components/ui/Spinner';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { C, R, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import { Icon } from '@/constants/icons';
import {
  TIERS,
  computeTrustBreakdown,
  type ProfileLike,
  type TrustComponent,
  type TrustTier,
} from '@/lib/trust/score';

type TrustProfileRow = ProfileLike & {
  id: string;
  trust_score: number | null;
};

const ACTIONS: { emoji: string; label: string; hint: string; route: string }[] = [
  { emoji: '📝', label: '投稿する', hint: '+0.5pt／件', route: '/post/create' },
  { emoji: '💬', label: 'スレッドに返信する', hint: '+0.4pt／件', route: '/bbs' },
  { emoji: '🏠', label: 'コミュニティに参加', hint: '新しい人と出会う', route: '/community/discover' },
  { emoji: '👋', label: 'プロフィール完成', hint: 'あなたを伝えよう', route: '/settings/profile-edit' },
];

export default function TrustScoreScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuthStore();

  const {
    data: profile,
    isLoading,
    isError,
  } = useQuery<TrustProfileRow | null>({
    queryKey: ['profile-trust', user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase
        .from('profiles')
        .select(
          'id, post_count, like_received_count, comment_count, concern_received_count, created_at, trust_score',
        )
        .eq('id', user.id)
        .single();
      if (error) throw error;
      return data as TrustProfileRow;
    },
    enabled: !!user,
    staleTime: 60 * 1000,
  });

  const breakdown = useMemo(() => {
    if (!profile) return null;
    return computeTrustBreakdown(profile);
  }, [profile]);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* ── Header ───────────────────────────────────────────── */}
      <View
        style={{
          paddingTop: insets.top + SP['2'],
          paddingHorizontal: SP['4'],
          paddingBottom: SP['2'],
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['2'],
        }}
      >
        <BackButton />
        <Text style={[T.h3, { color: C.text }]}>信用スコア</Text>
      </View>

      {isLoading && !profile ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Spinner size="large" />
        </View>
      ) : isError || !breakdown ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: SP['6'] }}>
          <Text style={[T.body, { color: C.text2, textAlign: 'center' }]}>
            スコアを読み込めませんでした。{'\n'}しばらくしてからもう一度お試しください。
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{
            paddingBottom: insets.bottom + SP['12'],
            paddingHorizontal: SP['4'],
            gap: SP['6'],
          }}
          showsVerticalScrollIndicator={false}
        >
          <Hero breakdown={breakdown} />
          <NextTier breakdown={breakdown} />
          <Breakdown components={breakdown.components} />
          <ActionList router={router} />
          <TierLadder currentKey={breakdown.tier.key} />
          <Disclaimer />
        </ScrollView>
      )}
    </View>
  );
}

// ── Hero gauge ───────────────────────────────────────────────────
function Hero({ breakdown }: { breakdown: ReturnType<typeof computeTrustBreakdown> }) {
  const { score, tier } = breakdown;
  const pct = Math.min(Math.max(score, 0), 100);
  return (
    <View
      style={{
        paddingVertical: SP['6'],
        paddingHorizontal: SP['4'],
        backgroundColor: C.bg2,
        borderRadius: R.xl,
        borderWidth: 1,
        borderColor: C.border,
        alignItems: 'center',
        gap: SP['4'],
      }}
    >
      <Text
        style={{
          fontSize: 64,
          fontWeight: '900',
          color: tier.color,
          lineHeight: 70,
          letterSpacing: -2,
        }}
      >
        {score}
      </Text>
      <View style={{ alignItems: 'center', gap: 2 }}>
        <Text style={{ fontSize: 28 }}>{tier.emoji}</Text>
        <Text style={[T.h3, { color: tier.color }]}>{tier.name}</Text>
      </View>
      <View
        style={{
          width: '100%',
          height: 8,
          borderRadius: R.full,
          backgroundColor: C.bg3,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${pct}%`,
            backgroundColor: tier.color,
            borderRadius: R.full,
          }}
        />
      </View>
      <View style={{ width: '100%', gap: SP['1'], marginTop: SP['2'] }}>
        {tier.perks.map((p, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: SP['2'], alignItems: 'flex-start' }}>
            <Text style={[T.small, { color: tier.color, lineHeight: 18 }]}>・</Text>
            <Text style={[T.small, { color: C.text2, flex: 1 }]}>{p}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ── Next tier progress ───────────────────────────────────────────
function NextTier({ breakdown }: { breakdown: ReturnType<typeof computeTrustBreakdown> }) {
  const { score, tier, nextTier, pointsToNext } = breakdown;
  if (!nextTier) {
    return (
      <View
        style={{
          paddingVertical: SP['3'],
          paddingHorizontal: SP['4'],
          backgroundColor: tier.color + '1a',
          borderRadius: R.lg,
          borderWidth: 1,
          borderColor: tier.color + '4d',
          alignItems: 'center',
        }}
      >
        <Text style={[T.bodyB, { color: tier.color }]}>最高ティアに到達しました 🎉</Text>
      </View>
    );
  }
  // 現在のティア下限 → 次のティア下限 の進捗
  const lower = tier.min;
  const upper = nextTier.min;
  const progress = Math.min(Math.max((score - lower) / (upper - lower), 0), 1);
  return (
    <View style={{ gap: SP['2'] }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text style={[T.smallM, { color: C.text2 }]}>
          次のティアまで あと <Text style={[T.bodyB, { color: nextTier.color }]}>{pointsToNext}</Text> pt
        </Text>
        <Text style={[T.small, { color: C.text3 }]}>
          {nextTier.emoji} {nextTier.name}
        </Text>
      </View>
      <View
        style={{ height: 6, borderRadius: R.full, backgroundColor: C.bg3, overflow: 'hidden' }}
      >
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${Math.round(progress * 100)}%`,
            backgroundColor: nextTier.color,
            borderRadius: R.full,
          }}
        />
      </View>
    </View>
  );
}

// ── Breakdown card ───────────────────────────────────────────────
function Breakdown({ components }: { components: TrustComponent[] }) {
  return (
    <View style={{ gap: SP['3'] }}>
      <Text style={[T.h4, { color: C.text }]}>スコアの内訳</Text>
      <View
        style={{
          backgroundColor: C.bg2,
          borderRadius: R.lg,
          borderWidth: 1,
          borderColor: C.border,
          overflow: 'hidden',
        }}
      >
        {components.map((c, i) => (
          <View key={c.key}>
            <ComponentRow comp={c} />
            {i < components.length - 1 && (
              <View style={{ height: 1, backgroundColor: C.divider }} />
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

function ComponentRow({ comp }: { comp: TrustComponent }) {
  const isNegative = comp.contribution < 0;
  const isBase = comp.key === 'base';
  const pct = isBase
    ? 100
    : Math.min(Math.max((Math.abs(comp.contribution) / comp.cap) * 100, 0), 100);
  const fillColor = isNegative ? C.red : isBase ? C.text3 : C.green;
  const signedLabel = isBase
    ? `+${comp.contribution}`
    : isNegative
      ? `${comp.contribution}`
      : `+${comp.contribution}`;
  return (
    <View style={{ padding: SP['4'], gap: SP['2'] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['3'] }}>
        <Text style={[T.bodyM, { color: C.text, flex: 1 }]}>{comp.label}</Text>
        {!isBase && (
          <Text style={[T.small, { color: C.text3 }]}>{comp.value.toLocaleString()}</Text>
        )}
        <Text
          style={[
            T.numLg,
            { color: fillColor, fontSize: 16, lineHeight: 22 },
          ]}
        >
          {signedLabel}
        </Text>
      </View>
      <View
        style={{ height: 4, borderRadius: R.full, backgroundColor: C.bg3, overflow: 'hidden' }}
      >
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${pct}%`,
            backgroundColor: fillColor,
            borderRadius: R.full,
          }}
        />
      </View>
      <Text style={[T.caption, { color: C.text3 }]}>{comp.hint}</Text>
    </View>
  );
}

// ── Action list ──────────────────────────────────────────────────
function ActionList({ router }: { router: ReturnType<typeof useRouter> }) {
  const ChevronR = Icon.chevronR;
  return (
    <View style={{ gap: SP['3'] }}>
      <Text style={[T.h4, { color: C.text }]}>今すぐスコアを上げる</Text>
      <View
        style={{
          backgroundColor: C.bg2,
          borderRadius: R.lg,
          borderWidth: 1,
          borderColor: C.border,
          overflow: 'hidden',
        }}
      >
        {ACTIONS.map((a, i) => (
          <View key={a.route}>
            <PressableScale
              onPress={() => router.push(a.route as never)}
              haptic="tap"
              scaleValue={0.99}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: SP['4'],
                paddingVertical: SP['3'],
                gap: SP['3'],
              }}
            >
              <Text style={{ fontSize: 22 }}>{a.emoji}</Text>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[T.bodyM, { color: C.text }]}>{a.label}</Text>
                <Text style={[T.caption, { color: C.text3 }]}>{a.hint}</Text>
              </View>
              <ChevronR size={16} color={C.text4} strokeWidth={2.2} />
            </PressableScale>
            {i < ACTIONS.length - 1 && (
              <View style={{ height: 1, backgroundColor: C.divider, marginLeft: SP['4'] + 22 + SP['3'] }} />
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

// ── Tier ladder ──────────────────────────────────────────────────
function TierLadder({ currentKey }: { currentKey: TrustTier['key'] }) {
  return (
    <View style={{ gap: SP['3'] }}>
      <Text style={[T.h4, { color: C.text }]}>ティア一覧</Text>
      <View style={{ gap: SP['2'] }}>
        {TIERS.map((tier) => {
          const isCurrent = tier.key === currentKey;
          return (
            <View
              key={tier.key}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                padding: SP['3'],
                backgroundColor: C.bg2,
                borderRadius: R.lg,
                borderWidth: isCurrent ? 1.5 : 1,
                borderColor: isCurrent ? tier.color : C.border,
                gap: SP['3'],
              }}
            >
              <Text style={{ fontSize: 24 }}>{tier.emoji}</Text>
              <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
                  <Text style={[T.bodyB, { color: tier.color }]}>{tier.name}</Text>
                  <Text style={[T.caption, { color: C.text3 }]}>
                    {tier.min}–{tier.max}
                  </Text>
                  {isCurrent && (
                    <View
                      style={{
                        paddingHorizontal: 6,
                        paddingVertical: 1,
                        borderRadius: R.full,
                        backgroundColor: tier.color,
                      }}
                    >
                      <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>現在</Text>
                    </View>
                  )}
                </View>
                <Text style={[T.small, { color: C.text2 }]} numberOfLines={1}>
                  {tier.perks[0]}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ── Disclaimer ───────────────────────────────────────────────────
function Disclaimer() {
  return (
    <Text style={[T.caption, { color: C.text3, lineHeight: 18, textAlign: 'center' }]}>
      報告を受けるとスコアが下がります。コミュニティを尊重した発言を心がけましょう。{'\n'}
      スコアは数分以内に反映されます。
    </Text>
  );
}
