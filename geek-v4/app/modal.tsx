import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { PressableScale } from '../components/ui/PressableScale';
import { Icon } from '../constants/icons';
import { C, R, SP } from '../design/tokens';
import { T } from '../design/typography';

// ジェネリックな modal demo — 通常ユーザーが直接到達することは無いが、
// expo-router の generated route として残しておく必要があるため、
// 他の screen と統一感のあるダークテーマで polish しておく。
export default function ModalScreen() {
  const router = useRouter();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: C.bg,
        alignItems: 'center',
        justifyContent: 'center',
        padding: SP['6'],
        gap: SP['4'],
      }}
    >
      <View
        style={{
          width: 88,
          height: 88,
          borderRadius: 44,
          backgroundColor: C.accentBg,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: C.accentSoft,
        }}
      >
        <Icon.sparkles size={40} color={C.accent} strokeWidth={1.8} />
      </View>
      <Text style={[T.h2, { color: C.text, textAlign: 'center' }]}>モーダル画面</Text>
      <Text style={[T.body, { color: C.text2, textAlign: 'center', maxWidth: 320 }]}>
        画面外をタップするか、下のボタンで閉じます
      </Text>
      <PressableScale
        onPress={() => router.back()}
        haptic="tap"
        hitSlop={10}
        style={{
          marginTop: SP['2'],
          paddingHorizontal: SP['5'],
          paddingVertical: SP['3'],
          backgroundColor: C.accent,
          borderRadius: R.full,
        }}
      >
        <Text style={[T.bodyMd, { color: '#fff', fontWeight: '700' }]}>閉じる</Text>
      </PressableScale>
    </View>
  );
}
