import { useState, useMemo } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, SP, R } from '../../design/tokens';
import { T } from '../../design/typography';
import { BackButton } from '../../components/nav/BackButton';
import { PressableScale } from '../../components/ui/PressableScale';
import { Icon } from '../../constants/icons';

const GOODS = [
  { title: 'ぬいぐるみ 限定版', tag: 'アニメ', type: '譲渡', price: '3,500円', color: C.pink },
  { title: 'アクリルスタンド セット', tag: 'キャラグッズ', type: '交換', price: '交換希望', color: C.accent },
  { title: 'ライブBlu-ray 未開封', tag: '音楽', type: '譲渡', price: '8,000円', color: C.blue },
  { title: 'トレカ SR まとめ売り', tag: 'トレカ', type: '譲渡', price: '5,000円', color: C.amber },
  { title: 'フィギュア 1/7スケール', tag: 'フィギュア', type: '交換', price: '交換希望', color: C.green },
];

type GoodsFilter = 'すべて' | '譲渡' | '交換';

export default function GoodsScreen() {
  const insets = useSafeAreaInsets();
  const GoodsIcon = Icon.goods;
  const [filter, setFilter] = useState<GoodsFilter>('すべて');

  // 「準備中」段階の demo データなので filter はクライアント側のみで動く
  const items = useMemo(() => {
    if (filter === 'すべて') return GOODS;
    return GOODS.filter((g) => g.type === filter);
  }, [filter]);

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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
          <Text style={[T.display, { color: C.text }]}>グッズ</Text>
          <View style={{
            paddingHorizontal: SP['2'], paddingVertical: 2,
            backgroundColor: C.amberBg, borderRadius: R.sm,
            borderWidth: 1, borderColor: C.amber + '55',
          }}>
            <Text style={[T.caption, { color: C.amber, fontWeight: '700' }]}>準備中</Text>
          </View>
        </View>
        <Text style={[T.body, { color: C.text2 }]}>譲渡・交換（近日対応）</Text>
      </View>

      <View style={{ flexDirection: 'row', gap: SP['2'] }}>
        {(['すべて', '譲渡', '交換'] as const).map((label) => {
          const active = filter === label;
          return (
            <PressableScale
              key={label}
              onPress={() => setFilter(label)}
              haptic="select"
              hitSlop={10}
              style={{
                paddingHorizontal: SP['4'],
                paddingVertical: SP['2'],
                backgroundColor: active ? C.accent : C.bg2,
                borderRadius: R.full,
                borderWidth: 1,
                borderColor: active ? C.accent : C.border,
              }}
            >
              <Text style={[T.small, { color: active ? '#fff' : C.text2, fontWeight: active ? '700' : '500' }]}>{label}</Text>
            </PressableScale>
          );
        })}
      </View>

      <View style={{ gap: SP['3'] }}>
        {items.length === 0 && (
          <View style={{
            padding: SP['8'],
            alignItems: 'center',
            gap: SP['2'],
          }}>
            {/* 装飾絵文字 (📦) 撤去 */}
            <Text style={[T.body, { color: C.text2 }]}>該当するグッズがありません</Text>
          </View>
        )}
        {items.map((g) => (
          <View
            // demo データだが title はユニークなので key にする (index より stable)
            key={g.title}
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
