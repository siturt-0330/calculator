import { View, Text, ScrollView } from 'react-native';
import { useMyBadges } from '@/hooks/useBadges';
import { C, R, SP } from '@/design/tokens';
import { T } from '@/design/typography';

const TIER_COLOR: Record<string, string> = {
  bronze: '#CD7F32',
  silver: '#C0C0C0',
  gold:   '#FFD700',
  rainbow: '#FF5E9B',
};

export function BadgeRibbon() {
  const { badges } = useMyBadges();
  if (badges.length === 0) {
    return (
      <View style={{
        marginHorizontal: SP['4'],
        marginTop: SP['3'],
        padding: SP['3'],
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1, borderColor: C.border,
        alignItems: 'center',
        gap: SP['1'],
      }}>
        <Text style={{ fontSize: 28 }}>🎖️</Text>
        <Text style={[T.smallM, { color: C.text2, fontWeight: '700' }]}>
          まだバッジはありません
        </Text>
        <Text style={[T.caption, { color: C.text3 }]}>
          投稿・コメント・リアクションを送ると獲得できます
        </Text>
      </View>
    );
  }
  return (
    <View style={{
      marginHorizontal: SP['4'],
      marginTop: SP['3'],
      padding: SP['3'],
      backgroundColor: C.bg2,
      borderRadius: R.lg,
      borderWidth: 1, borderColor: C.border,
      gap: SP['2'],
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={{ fontSize: 16 }}>🎖️</Text>
        <Text style={[T.smallM, { color: C.text, fontWeight: '700', flex: 1 }]}>
          獲得バッジ ({badges.length})
        </Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SP['2'], paddingVertical: 4 }}>
        {badges.map((b) => (
          <View key={b.code} style={{
            alignItems: 'center', gap: 2,
            padding: SP['2'],
            backgroundColor: C.bg3,
            borderRadius: R.md,
            borderWidth: 1.5, borderColor: TIER_COLOR[b.tier] ?? C.border,
            minWidth: 78,
          }}>
            <Text style={{ fontSize: 24 }}>{b.emoji}</Text>
            <Text style={{ fontSize: 9, color: C.text, fontWeight: '700', textAlign: 'center' }} numberOfLines={1}>
              {b.name}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
