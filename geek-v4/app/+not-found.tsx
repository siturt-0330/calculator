import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { PressableScale } from '../components/ui/PressableScale';
import { Icon } from '../constants/icons';
import { C, R, SP } from '../design/tokens';
import { T } from '../design/typography';

export default function NotFound() {
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
      {/* Glow halo + search icon — empty-state と同じビジュアル言語 */}
      <View
        style={{
          width: 112,
          height: 112,
          borderRadius: 56,
          backgroundColor: C.accentBg,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: C.accentSoft,
          shadowColor: C.accent,
          shadowOpacity: 0.25,
          shadowRadius: 22,
          shadowOffset: { width: 0, height: 0 },
        }}
      >
        <Icon.search size={52} color={C.accent} strokeWidth={1.6} />
      </View>

      <Text
        style={[T.display, { color: C.text, textAlign: 'center', letterSpacing: -0.5 }]}
      >
        ページが見つかりません
      </Text>
      <Text
        style={[
          T.body,
          { color: C.text2, textAlign: 'center', maxWidth: 320, lineHeight: 22 },
        ]}
      >
        URL が間違っているか、ページが削除された可能性があります。
      </Text>

      <PressableScale
        onPress={() => router.replace('/(tabs)/feed' as never)}
        haptic="confirm"
        hitSlop={10}
        style={{
          marginTop: SP['3'],
          paddingHorizontal: SP['5'],
          paddingVertical: SP['3'],
          backgroundColor: C.accent,
          borderRadius: R.full,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <Icon.home size={16} color="#fff" strokeWidth={2.6} />
        <Text style={[T.bodyMd, { color: '#fff', fontWeight: '700' }]}>ホームへ戻る</Text>
      </PressableScale>
    </View>
  );
}
