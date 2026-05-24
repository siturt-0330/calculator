import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';
import { C, SP, R } from '../../design/tokens';
import { T } from '../../design/typography';

// ============================================================
// OfficialFeatureNav — 公式コミュニティの機能ナビ (Q&A / カレンダー / 地図)
// ============================================================
// 元は app/(tabs)/community/[id]/index.tsx 内にあった。
// 表示するアイコンは features 配列でコントロールされる (組合せ自由)。
// ============================================================
type FeatureKey = 'qna' | 'calendar' | 'map';

export function OfficialFeatureNav({
  communityId,
  features,
}: {
  communityId: string;
  features: FeatureKey[];
}) {
  const router = useRouter();
  type Item = { key: FeatureKey; label: string; icon: typeof Icon.community; route: string };
  const items: Item[] = [];
  if (features.includes('qna')) items.push({ key: 'qna', label: 'Q&A', icon: Icon.help, route: `/community/${communityId}/qna` });
  if (features.includes('calendar')) items.push({ key: 'calendar', label: 'カレンダー', icon: Icon.calendar, route: `/community/${communityId}/calendar` });
  if (features.includes('map')) items.push({ key: 'map', label: '地図', icon: Icon.map, route: `/community/${communityId}/map` });
  if (items.length === 0) return null;
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: SP['2'],
        paddingHorizontal: SP['4'],
        paddingVertical: SP['3'],
        borderBottomWidth: 1,
        borderBottomColor: C.border,
        flexWrap: 'wrap',
      }}
    >
      {items.map((it) => {
        const IconComp = it.icon;
        return (
          <PressableScale
            key={it.key}
            onPress={() => router.push(it.route as never)}
            haptic="tap"
            scaleValue={0.97}
            accessibilityLabel={`${it.label} を開く`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: SP['3'],
              paddingVertical: 8,
              backgroundColor: C.accentBg,
              borderRadius: R.full,
              borderWidth: 1,
              borderColor: C.accent + '55',
            }}
          >
            <IconComp size={14} color={C.accentLight} strokeWidth={2.4} />
            <Text style={[T.smallM, { color: C.accentLight, fontWeight: '700' }]}>{it.label}</Text>
          </PressableScale>
        );
      })}
    </View>
  );
}
