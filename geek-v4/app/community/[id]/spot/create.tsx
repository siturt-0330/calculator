// ============================================================
// 聖地作成 (community spot create) — placeholder stub
// 後で地図ベース UI に置き換える
// ============================================================
import { View, Text } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import { BackButton } from '@/components/nav/BackButton';
import { Icon } from '@/constants/icons';

export default function CreateSpotScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const id = typeof params.id === 'string' ? params.id : '';

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: C.bg,
        paddingTop: insets.top + SP['2'],
        paddingHorizontal: SP['4'],
        gap: SP['4'],
      }}
    >
      <BackButton />
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: SP['3'] }}>
        <Icon.map size={48} color={C.text3} strokeWidth={1.6} />
        <Text style={[T.h3, { color: C.text }]}>聖地の追加</Text>
        <Text style={[T.body, { color: C.text2, textAlign: 'center' }]}>
          地図ベースの聖地登録 UI は近日公開予定です。
        </Text>
        <Text style={[T.caption, { color: C.text3 }]}>community: {id}</Text>
      </View>
    </View>
  );
}
