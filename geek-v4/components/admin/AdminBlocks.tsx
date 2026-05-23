import { View, Text } from 'react-native';
import { PressableScale } from '../ui/PressableScale';
import { C, SP, R } from '../../design/tokens';
import { T } from '../../design/typography';

// ============================================================
// AdminBlocks — admin/index.tsx 内で共通利用される小さな UI piece
// ============================================================
// 元は admin/index.tsx (1383 行) の末尾にローカル定義されていたが、
// 同一の Stat / EmptyBlock / ErrorBlock パターンは他の admin 画面
// (admin/user/[id].tsx, admin/post/[id].tsx 等) にも複数現れている。
// 共通化して再利用しやすくする + 元ファイルを縮める。
// ============================================================

export function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
      <Text style={[T.caption, { color: C.text3 }]}>{label}</Text>
      <Text style={[T.smallB, { color: accent ?? C.text, fontWeight: '700' }]}>{value}</Text>
    </View>
  );
}

export function EmptyBlock({ label, emoji = '📭' }: { label: string; emoji?: string }) {
  return (
    <View
      style={{
        padding: SP['8'],
        alignItems: 'center',
        gap: SP['2'],
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
      }}
    >
      <Text style={{ fontSize: 36 }} accessibilityElementsHidden>{emoji}</Text>
      <Text style={[T.body, { color: C.text2 }]}>{label}</Text>
    </View>
  );
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={{ padding: SP['8'], alignItems: 'center', gap: SP['3'] }}>
      <Text style={{ fontSize: 36 }} accessibilityElementsHidden>⚠️</Text>
      <Text style={[T.body, { color: C.text2, textAlign: 'center' }]}>{message}</Text>
      <PressableScale
        onPress={onRetry}
        haptic="tap"
        accessibilityLabel="再読み込み"
        style={{
          paddingHorizontal: SP['4'],
          paddingVertical: SP['2'],
          backgroundColor: C.bg3,
          borderRadius: R.full,
          borderWidth: 1,
          borderColor: C.border,
        }}
      >
        <Text style={[T.smallM, { color: C.text }]}>再読み込み</Text>
      </PressableScale>
    </View>
  );
}
