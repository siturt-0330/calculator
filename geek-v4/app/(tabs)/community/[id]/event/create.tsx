// ============================================================
// イベント作成 (community event create) — placeholder stub
// 後で日時 picker + 場所入力 UI に置き換える
// ============================================================
import { View, Text } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, SP } from '../../../../../design/tokens';
import { T } from '../../../../../design/typography';
import { BackButton } from '../../../../../components/nav/BackButton';
import { Icon } from '../../../../../constants/icons';

export default function CreateEventScreen() {
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
        <Icon.calendar size={48} color={C.text3} strokeWidth={1.6} />
        <Text style={[T.h3, { color: C.text }]}>イベントの追加</Text>
        <Text style={[T.body, { color: C.text2, textAlign: 'center' }]}>
          イベント登録 UI は近日公開予定です。
        </Text>
        <Text style={[T.caption, { color: C.text3 }]}>community: {id}</Text>
      </View>
    </View>
  );
}
