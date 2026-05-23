import { View, Text } from 'react-native';
import { C } from '../../design/tokens';
import { T } from '../../design/typography';

// ============================================================
// MiniMetric — admin 系画面で 1 行に「icon + 数値」を並べる小さい表示
// ============================================================
// 元は app/admin/user/[id].tsx の末尾 (shared helpers) に定義されていた。
// admin/post / admin/index でも似たパターンがあり、共通化候補。
// ============================================================
export function MiniMetric({ icon, value, accent }: { icon: string; value: number; accent?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Text style={{ fontSize: 11, color: accent ?? C.text3 }} accessibilityElementsHidden>{icon}</Text>
      <Text style={[T.smallB, { color: accent ?? C.text, fontWeight: '700' }]}>{value}</Text>
    </View>
  );
}
