import { View, Text, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, SP, R } from '@/design/tokens';
import { T } from '@/design/typography';
import { BackButton } from '@/components/nav/BackButton';
import { Icon } from '@/constants/icons';

const GOODS = [
  { title: 'ぬいぐるみ 限定版', tag: 'アニメ', type: '譲渡', price: '3,500円', color: C.pink },
  { title: 'アクリルスタンド セット', tag: 'キャラグッズ', type: '交換', price: '交換希望', color: C.accent },
  { title: 'ライブBlu-ray 未開封', tag: '音楽', type: '譲渡', price: '8,000円', color: C.blue },
  { title: 'トレカ SR まとめ売り', tag: 'トレカ', type: '譲渡', price: '5,000円', color: C.amber },
  { title: 'フィギュア 1/7スケール', tag: 'フィギュア', type: '交換', price: '交換希望', color: C.green },
];

export default function GoodsScreen() {
  const insets = useSafeAreaInsets();
  const GoodsIcon = Icon.goods;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{
        paddingTop: insets.top + SP['4'],
        paddingBottom: insets.bottom + SP['10'],
        paddingHorizontal: SP['4'],
        gap: SP['4'],
      }}
    >
      <BackButton />

      <View style={{ gap: SP['1'] }}>
        <Text style={[T.display, { color: C.text }]}>グッズ</Text>
        <Text style={[T.body, { color: C.text2 }]}>譲渡・交換</Text>
      </View>

      <View style={{ flexDirection: 'row', gap: SP['2'] }}>
        {(['すべて', '譲渡', '交換'] as const).map((label) => (
          <View
            key={label}
            style={{
              paddingHorizontal: SP['4'],
              paddingVertical: SP['2'],
              backgroundColor: label === 'すべて' ? C.accent : C.bg2,
              borderRadius: R.full,
              borderWidth: 1,
              borderColor: label === 'すべて' ? C.accent : C.border,
            }}
          >
            <Text style={[T.small, { color: label === 'すべて' ? '#fff' : C.text2 }]}>{label}</Text>
          </View>
        ))}
      </View>

      <View style={{ gap: SP['3'] }}>
        {GOODS.map((g, i) => (
          <View
            key={i}
            style={{
              flexDirection: 'row',
              gap: SP['3'],
              padding: SP['4'],
              backgroundColor: C.bg2,
              borderRadius: R.lg,
              borderWidth: 1,
              borderColor: C.border,
              alignItems: 'center',
            }}
          >
            <View style={{
              width: 48,
              height: 48,
              borderRadius: R.md,
              backgroundColor: C.bg3,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <GoodsIcon size={22} color={g.color} strokeWidth={2} />
            </View>
            <View style={{ flex: 1, gap: SP['1'] }}>
              <Text style={[T.bodyMd, { color: C.text }]}>{g.title}</Text>
              <View style={{ flexDirection: 'row', gap: SP['2'], alignItems: 'center' }}>
                <View style={{
                  paddingHorizontal: SP['2'],
                  paddingVertical: 2,
                  backgroundColor: C.bg3,
                  borderRadius: R.sm,
                }}>
                  <Text style={[T.caption, { color: C.text3 }]}>#{g.tag}</Text>
                </View>
                <View style={{
                  paddingHorizontal: SP['2'],
                  paddingVertical: 2,
                  backgroundColor: g.type === '譲渡' ? C.greenBg : C.accentSoft,
                  borderRadius: R.sm,
                }}>
                  <Text style={[T.caption, { color: g.type === '譲渡' ? C.green : C.accentLight }]}>{g.type}</Text>
                </View>
              </View>
            </View>
            <Text style={[T.bodyMd, { color: C.text, fontWeight: '600' }]}>{g.price}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
