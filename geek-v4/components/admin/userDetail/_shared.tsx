// ============================================================
// userDetail/_shared.tsx — admin/user/[id] 3 タブ共通
// ============================================================
// 現状は UserDetailEmptyState 1 個だけ。
// 将来 tab 横断 helper が増えたらここに足す。
// ============================================================
import Animated, { FadeIn } from 'react-native-reanimated';
import { Text } from 'react-native';
import { C, R, SP } from '../../../design/tokens';
import { T } from '../../../design/typography';

export function UserDetailEmptyState({ icon, title, hint }: { icon: string; title: string; hint?: string }) {
  return (
    <Animated.View
      entering={FadeIn.duration(260)}
      style={{
        marginHorizontal: SP['4'],
        paddingVertical: SP['10'],
        paddingHorizontal: SP['4'],
        alignItems: 'center',
        gap: SP['2'],
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
        borderStyle: 'dashed',
      }}
    >
      <Text style={{ fontSize: 40 }}>{icon}</Text>
      <Text style={[T.bodyB, { color: C.text2 }]}>{title}</Text>
      {hint && (
        <Text style={[T.caption, { color: C.text4, textAlign: 'center' }]}>{hint}</Text>
      )}
    </Animated.View>
  );
}
