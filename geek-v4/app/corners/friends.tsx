import { View, Text, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, SP, R } from '../../design/tokens';
import { T } from '../../design/typography';
import { BackButton } from '../../components/nav/BackButton';
import { Icon } from '../../constants/icons';

const PROFILES = [
  { name: 'オタク太郎', tags: ['アニメ', 'ゲーム'], msg: '一緒にオフ会参加する人募集！', color: '#7C6AF7' },
  { name: 'ぬい推し花子', tags: ['ぬいぐるみ', 'グッズ'], msg: 'グッズ交換お気軽にどうぞ〜', color: '#F472B6' },
  { name: 'レトロゲーマー', tags: ['ゲーム', 'レトロ'], msg: 'ファミコン世代。同じ趣味の友達欲しい', color: '#22D3A4' },
  { name: '声優沼の住人', tags: ['声優', 'アニメ'], msg: '現場で会いましょう！', color: '#F5A623' },
  { name: 'トレカ廃人', tags: ['トレカ', 'コレクター'], msg: '交換・対戦相手募集中です', color: '#3B82F6' },
];

export default function FriendsScreen() {
  const insets = useSafeAreaInsets();
  const FriendsIcon = Icon.friends;

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
          <Text style={[T.display, { color: C.text }]}>友達作り</Text>
          <View style={{
            paddingHorizontal: SP['2'], paddingVertical: 2,
            backgroundColor: C.amberBg, borderRadius: R.sm,
            borderWidth: 1, borderColor: C.amber + '55',
          }}>
            <Text style={[T.caption, { color: C.amber, fontWeight: '700' }]}>準備中</Text>
          </View>
        </View>
        <Text style={[T.body, { color: C.text2 }]}>同好の士を見つけよう（近日対応）</Text>
      </View>

      <View style={{
        padding: SP['4'],
        backgroundColor: C.accentBg,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.accentSoft,
        flexDirection: 'row',
        gap: SP['3'],
        alignItems: 'center',
      }}>
        <FriendsIcon size={24} color={C.accent} strokeWidth={2} />
        <Text style={[T.small, { color: C.text2, flex: 1 }]}>
          すべてのやり取りは匿名。趣味つながりで安心して話せます。
        </Text>
      </View>

      <View style={{ gap: SP['3'] }}>
        {PROFILES.map((p, i) => (
          <View
            key={i}
            style={{
              padding: SP['4'],
              backgroundColor: C.bg2,
              borderRadius: R.lg,
              borderWidth: 1,
              borderColor: C.border,
              gap: SP['3'],
            }}
          >
            <View style={{ flexDirection: 'row', gap: SP['3'], alignItems: 'center' }}>
              <View style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: p.color + '33',
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 2,
                borderColor: p.color + '66',
              }}>
                <Text style={{ fontSize: 20 }}>👤</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[T.h4, { color: C.text }]}>{p.name}</Text>
                <View style={{ flexDirection: 'row', gap: SP['1'], marginTop: 2, flexWrap: 'wrap' }}>
                  {p.tags.map((tag) => (
                    <View key={tag} style={{
                      paddingHorizontal: SP['2'],
                      paddingVertical: 1,
                      backgroundColor: C.accentSoft,
                      borderRadius: R.sm,
                    }}>
                      <Text style={[T.caption, { color: C.accentLight }]}>#{tag}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </View>
            <Text style={[T.small, { color: C.text2 }]}>{p.msg}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
