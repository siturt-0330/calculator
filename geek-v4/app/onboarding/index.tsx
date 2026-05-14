import { View, Text, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { C, GRAD, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import { Button } from '@/components/ui/Button';
import { FONT } from '@/design/typography';

const CARDS = [
  { emoji: '🎭', title: '完全匿名', desc: '誰が投稿したか分からない。だから言いたいことを言える。' },
  { emoji: '🏷️', title: 'タグで繋がる', desc: '好きなタグだけ、嫌いなタグは除外。あなただけのフィード。' },
  { emoji: '🛡️', title: '信頼スコア', desc: '良いコミュニティへの貢献がスコアになる。荒らしを自然に排除。' },
  { emoji: '✨', title: '趣味の深みへ', desc: 'カレンダー・マップ・グッズ・友達作りで趣味を極める。' },
];

export default function OnboardingIndex() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <LinearGradient
        colors={[C.accentBg, C.bg]}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 300 }}
      />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + SP['8'],
          paddingBottom: insets.bottom + SP['6'],
          paddingHorizontal: SP['6'],
          gap: SP['6'],
        }}
      >
        <View style={{ alignItems: 'center', gap: SP['2'] }}>
          <Text
            style={{
              fontFamily: FONT.display,
              fontSize: 56,
              color: C.text,
              letterSpacing: -1,
            }}
          >
            Geek
          </Text>
          <Text style={[T.body, { color: C.text2, textAlign: 'center' }]}>
            好きを、匿名で、安心して続ける
          </Text>
        </View>

        <View style={{ gap: SP['3'] }}>
          {CARDS.map((c) => (
            <View
              key={c.title}
              style={{
                flexDirection: 'row',
                gap: SP['4'],
                padding: SP['4'],
                backgroundColor: C.bg2,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: C.border,
              }}
            >
              <Text style={{ fontSize: 32 }}>{c.emoji}</Text>
              <View style={{ flex: 1, gap: SP['1'] }}>
                <Text style={[T.h4, { color: C.text }]}>{c.title}</Text>
                <Text style={[T.small, { color: C.text2 }]}>{c.desc}</Text>
              </View>
            </View>
          ))}
        </View>

        <Button
          label="はじめる"
          onPress={() => router.push('/onboarding/nickname')}
          haptic="confirm"
        />
      </ScrollView>
    </View>
  );
}
