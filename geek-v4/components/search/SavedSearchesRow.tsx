// ============================================================
// SavedSearchesRow — 保存した検索の chip 一覧 (search screen トップ)
// ============================================================
// app/search.tsx から抽出。query が空のときだけ親が描画する想定。
// 各 chip は本体 (タップで検索) + ✕ (削除) の 2 ボタン構成。
// ============================================================
import { Text, View } from 'react-native';
import { PressableScale } from '../ui/PressableScale';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';

export function SavedSearchesRow({
  items,
  onSelect,
  onRemove,
}: {
  items: Array<{ id: string; query: string }>;
  onSelect: (query: string) => void;
  onRemove: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <View style={{ gap: SP['1'] }}>
      <Text style={[T.smallM, { color: C.text3, letterSpacing: 0.5 }]}>保存した検索</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {items.map((s) => (
          <View key={s.id} style={{
            flexDirection: 'row', alignItems: 'center', gap: 4,
            paddingHorizontal: SP['2'], paddingVertical: 4,
            backgroundColor: C.accentBg, borderRadius: R.full,
            borderWidth: 1, borderColor: C.accentSoft,
          }}>
            <PressableScale onPress={() => onSelect(s.query)} haptic="tap">
              <Text style={[T.caption, { color: C.accentLight, fontWeight: '700' }]}>★ {s.query}</Text>
            </PressableScale>
            <PressableScale onPress={() => onRemove(s.id)} haptic="warn">
              <Text style={{ fontSize: 10, color: C.text3 }}>✕</Text>
            </PressableScale>
          </View>
        ))}
      </View>
    </View>
  );
}
