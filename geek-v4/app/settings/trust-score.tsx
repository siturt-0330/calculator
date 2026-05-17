import { View, Text, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { TopBar } from '@/components/nav/TopBar';
import { BackButton } from '@/components/nav/BackButton';
import { TrustBar } from '@/components/ui/TrustBar';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { C, R, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import { Icon } from '@/constants/icons';

const FACTORS = [
  { icon: Icon.check, label: 'アカウント開設', score: '+10', color: C.green },
  { icon: Icon.heart, label: 'いいねを受けた', score: '+15', color: C.pink },
  { icon: Icon.comment, label: '建設的なコメント', score: '+20', color: C.accent },
  { icon: Icon.shield, label: '通報されていない', score: '+5', color: C.blue },
];

const TIPS = [
  '誠実なコメントは高く評価されます',
  '通報を受けるとスコアが下がります',
  '70以上で「信頼ユーザー」バッジが付与されます',
  'スコアは投稿の表示優先度に影響します',
];

export default function TrustScoreScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const Award = Icon.award;

  const { data: profile } = useQuery({
    queryKey: ['trust-profile', user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase
        .from('profiles')
        .select('trust_score, post_count, like_received_count, concern_received_count, account_state')
        .eq('id', user.id)
        .single();
      return data as {
        trust_score: number;
        post_count: number;
        like_received_count: number;
        concern_received_count: number;
        account_state: string;
      } | null;
    },
    enabled: !!user,
  });

  const score = profile?.trust_score ?? 50;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="信頼スコア" left={<BackButton />} />
      <ScrollView
        contentContainerStyle={{
          padding: SP['4'],
          paddingBottom: insets.bottom + SP['10'],
          gap: SP['5'],
        }}
      >
        <View style={{
          padding: SP['6'],
          backgroundColor: C.bg2,
          borderRadius: R.xl,
          borderWidth: 1,
          borderColor: C.border,
          alignItems: 'center',
          gap: SP['4'],
        }}>
          <Award size={48} color={C.accent} strokeWidth={1.5} />
          <Text style={[T.display, { color: C.text }]}>{score}</Text>
          <Text style={[T.body, { color: C.text2 }]}>あなたの信頼スコア</Text>
          <View style={{ width: '100%' }}>
            <TrustBar score={score} />
          </View>
        </View>

        <View>
          <Text style={[T.h4, { color: C.text, marginBottom: SP['3'] }]}>加点要素</Text>
          <View style={{ gap: SP['2'] }}>
            {FACTORS.map((f, i) => {
              const I = f.icon;
              return (
                <View key={i} style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  padding: SP['4'],
                  backgroundColor: C.bg2,
                  borderRadius: R.lg,
                  borderWidth: 1,
                  borderColor: C.border,
                  gap: SP['3'],
                }}>
                  <View style={{
                    width: 36, height: 36, borderRadius: 18,
                    backgroundColor: f.color + '22',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <I size={18} color={f.color} strokeWidth={2.2} />
                  </View>
                  <Text style={[T.body, { color: C.text, flex: 1 }]}>{f.label}</Text>
                  <Text style={[T.bodyMd, { color: f.color, fontWeight: '600' }]}>{f.score}</Text>
                </View>
              );
            })}
          </View>
        </View>

        <View>
          <Text style={[T.h4, { color: C.text, marginBottom: SP['3'] }]}>スコアアップのヒント</Text>
          <View style={{
            padding: SP['4'],
            backgroundColor: C.accentBg,
            borderRadius: R.lg,
            borderWidth: 1,
            borderColor: C.accentSoft,
            gap: SP['2'],
          }}>
            {TIPS.map((tip, i) => (
              <Text key={i} style={[T.small, { color: C.text2 }]}>・{tip}</Text>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
