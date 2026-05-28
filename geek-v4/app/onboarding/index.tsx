import { View, Text, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { C, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../constants/icons';
import type { LucideIcon } from 'lucide-react-native';

const CARDS: { icon: LucideIcon; color: string; bg: string; title: string; desc: string }[] = [
  {
    icon: Icon.lock,
    color: '#7C6AF7',
    bg: '#2D2940',
    title: '完全匿名',
    desc: '投稿は匿名表示。発信ハードルが下がり、本音で語れます。',
  },
  {
    icon: Icon.hash,
    color: '#22D3A4',
    bg: '#0d2a22',
    title: 'タグで繋がる',
    desc: '好きなタグだけ表示。嫌なタグは除外。自分専用のタイムライン。',
  },
  {
    icon: Icon.shield,
    color: '#3B82F6',
    bg: '#0d1f3a',
    title: '構造的な安全',
    desc: '炎上・誹謗中傷を起きにくく設計。安心して発信できます。',
  },
  {
    icon: Icon.sparkles,
    color: '#F472B6',
    bg: '#2a1525',
    title: '推し活が捗る',
    desc: 'カレンダー・聖地マップ・ゲームで趣味を深めるコーナーを用意。',
  },
];

export default function OnboardingIndex() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <LinearGradient
        colors={[C.accentBg, C.bg]}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 360 }}
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
              fontFamily: 'Orbitron_900Black',
              fontSize: 56,
              color: C.text,
              letterSpacing: -1,
            }}
          >
            Geek
          </Text>
          <Text style={[T.body, { color: C.text2, textAlign: 'center' }]}>
            好きを、匿名で、安心して続ける。
          </Text>
        </View>

        <View style={{ gap: SP['3'] }}>
          {CARDS.map((c) => {
            const I = c.icon;
            return (
              <View
                key={c.title}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: SP['4'],
                  padding: SP['4'],
                  backgroundColor: C.bg2,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: C.border,
                }}
              >
                <View style={{
                  width: 48, height: 48, borderRadius: 12,
                  backgroundColor: c.bg,
                  alignItems: 'center', justifyContent: 'center',
                  borderWidth: 1, borderColor: c.color + '44',
                }}>
                  <I size={24} color={c.color} strokeWidth={2} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[T.h4, { color: C.text }]}>{c.title}</Text>
                  <Text style={[T.small, { color: C.text2 }]}>{c.desc}</Text>
                </View>
              </View>
            );
          })}
        </View>

        <View style={{ gap: SP['2'] }}>
          <Button
            label="はじめる / Start"
            onPress={() => router.push('/onboarding/language' as never)}
            haptic="confirm"
          />
          <Text style={[T.caption, { color: C.text3, textAlign: 'center' }]}>
            約 1 分のセットアップ・あとから変更できます
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
