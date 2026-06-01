import { useMemo } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { BackButton } from '../../components/nav/BackButton';
import { Spinner } from '../../components/ui/Spinner';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../stores/authStore';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import {
  computeTrustBreakdown,
  type ProfileLike,
  type TrustComponent,
} from '../../lib/trust/score';

// ============================================================
// /settings/trust-score
// ------------------------------------------------------------
// 2026-05 改修: ティアの肩書 (新参者/常連/...) は UI から非表示。
// 代わりに「内部スコア (0-100)」を numeric で表示し、
// 何のために存在するかを説明する画面に簡素化。
//
// サーバ側 (anti-spam: コメント投稿の min trust score 等) は
// lib/trust/score.ts の computeTrustBreakdown を引き続き利用する。
// ============================================================

type TrustProfileRow = ProfileLike & {
  id: string;
  trust_score: number | null;
};

export default function TrustScoreScreen() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);

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
        <Text style={[T.h3, { color: C.text }]}>信頼スコア</Text>
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
          <Hero score={breakdown.score} />
          <About />
          <Breakdown components={breakdown.components} />
          <Disclaimer />
        </ScrollView>
      )}
    </View>
  );
}

// ── Hero (numeric score のみ) ────────────────────────────────────
function Hero({ score }: { score: number }) {
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
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
        <Text
          style={{
            fontSize: 64,
            fontWeight: '900',
            color: C.text,
            lineHeight: 70,
            letterSpacing: -2,
          }}
        >
          {score}
        </Text>
        <Text style={[T.body, { color: C.text3 }]}>/ 100</Text>
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
            backgroundColor: C.accent,
            borderRadius: R.full,
          }}
        />
      </View>
    </View>
  );
}

// ── About (何のためのスコアか) ───────────────────────────────────
function About() {
  return (
    <View
      style={{
        padding: SP['4'],
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
        gap: SP['2'],
      }}
    >
      <Text style={[T.h4, { color: C.text }]}>このスコアについて</Text>
      <Text style={[T.body, { color: C.text2, lineHeight: 22 }]}>
        Geek の安全性を保つため、内部スコアでユーザーの活動傾向を判定しています。
        スコアは自分以外には公開されません。
      </Text>
      <Text style={[T.small, { color: C.text3, lineHeight: 18 }]}>
        投稿・いいね・コメント・利用日数で加算され、他のユーザーから「気になる」を多く受けると減算されます。
      </Text>
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

// ── Disclaimer ───────────────────────────────────────────────────
function Disclaimer() {
  return (
    <Text style={[T.caption, { color: C.text3, lineHeight: 18, textAlign: 'center' }]}>
      「気になる」を多く受けるとスコアが下がります。コミュニティを尊重した発言を心がけましょう。{'\n'}
      スコアは数分以内に反映されます。
    </Text>
  );
}
