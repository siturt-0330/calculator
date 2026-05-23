import { View, Text } from 'react-native';
import { SP, R } from '../../design/tokens';
import { T } from '../../design/typography';

// ============================================================
// StatBadge — emoji + label のミニチップ。背景は color の 22% (透過)。
// ============================================================
// app/oshi/tag-graph.tsx 内に定義されていたが、StatPill / MiniMetric
// (admin/user/[id].tsx) と類似パターン。共通 UI 化することで
// 1000+ 行ファイルを縮められる。
// ============================================================
export function StatBadge({ icon, label, color }: { icon: string; label: string; color: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: SP['2'],
        paddingVertical: 3,
        backgroundColor: color + '22',
        borderWidth: 1,
        borderColor: color + '44',
        borderRadius: R.full,
      }}
    >
      <Text style={{ fontSize: 12 }} accessibilityElementsHidden>{icon}</Text>
      <Text style={[T.caption, { color, fontWeight: '700' }]}>{label}</Text>
    </View>
  );
}
