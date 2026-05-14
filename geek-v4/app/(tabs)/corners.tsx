import { View, Text, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Icon } from '@/constants/icons';
import { PressableScale } from '@/components/ui/PressableScale';
import { C, GRAD, R, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import { SHADOW } from '@/design/shadows';
import { TABBAR } from '@/design/tabbar';

const CORNERS = [
  {
    key: 'calendar',
    label: 'カレンダー',
    sub: '今週の推しイベント',
    icon: Icon.calendar,
    route: '/corners/calendar' as const,
    grad: [...GRAD.accent] as [string, string],
  },
  {
    key: 'map',
    label: 'マップ',
    sub: '聖地・スポット',
    icon: Icon.map,
    route: '/corners/map' as const,
    grad: [...GRAD.accentSoft] as [string, string],
  },
  {
    key: 'goods',
    label: 'グッズ',
    sub: '譲渡・交換',
    icon: Icon.goods,
    route: '/corners/goods' as const,
    grad: [...GRAD.accent] as [string, string],
  },
  {
    key: 'friends',
    label: '友達作り',
    sub: '同好の士を見つけよう',
    icon: Icon.friends,
    route: '/corners/friends' as const,
    grad: [...GRAD.accentSoft] as [string, string],
  },
];

export default function CornersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{
        paddingBottom: TABBAR.height + insets.bottom + SP['10'],
      }}
    >
      <View style={{ paddingTop: insets.top + SP['4'], paddingHorizontal: SP['4'] }}>
        <Text style={[T.display, { color: C.text }]}>コーナー</Text>
        <Text style={[T.body, { color: C.text2, marginTop: SP['1'] }]}>
          趣味を深める 4 つの場所
        </Text>
      </View>

      <View
        style={{ flexDirection: 'row', flexWrap: 'wrap', padding: SP['4'], gap: SP['3'] }}
      >
        {CORNERS.map((c) => {
          const I = c.icon;
          return (
            <PressableScale
              key={c.key}
              onPress={() => router.push(c.route as never)}
              style={{
                width: '48%',
                aspectRatio: 1,
                borderRadius: R.xl,
                overflow: 'hidden',
                ...SHADOW.card,
              }}
            >
              <LinearGradient
                colors={c.grad}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ flex: 1, padding: SP['4'], justifyContent: 'space-between' }}
              >
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    backgroundColor: 'rgba(255,255,255,0.18)',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.25)',
                  }}
                >
                  <I size={22} color="#fff" strokeWidth={2.4} />
                </View>
                <View>
                  <Text style={[T.h2, { color: '#fff' }]}>{c.label}</Text>
                  <Text
                    style={[T.small, { color: 'rgba(255,255,255,0.85)', marginTop: SP['1'] }]}
                  >
                    {c.sub}
                  </Text>
                </View>
              </LinearGradient>
            </PressableScale>
          );
        })}
      </View>
    </ScrollView>
  );
}
