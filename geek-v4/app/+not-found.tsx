import { View, Text } from 'react-native';
import { Link } from 'expo-router';
import { C, SP } from '@/design/tokens';
import { T } from '@/design/typography';

export default function NotFound() {
  return (
    <View
      style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: SP['6'] }}
    >
      <Text style={[T.h2, { color: C.text, marginBottom: SP['3'] }]}>404</Text>
      <Text style={[T.body, { color: C.text2, marginBottom: SP['6'] }]}>
        ページが見つかりません。
      </Text>
      <Link href="/(tabs)/feed">
        <Text style={[T.bodyM, { color: C.accent }]}>ホームへ戻る</Text>
      </Link>
    </View>
  );
}
