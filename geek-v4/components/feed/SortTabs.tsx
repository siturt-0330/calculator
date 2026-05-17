import { View, Text } from 'react-native';
import { PressableScale } from '@/components/ui/PressableScale';
import { C, R, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import type { SortMode } from '@/lib/api/posts';

const LABELS: Record<SortMode, { label: string; emoji: string }> = {
  hot: { label: 'Hot', emoji: '🔥' },
  new: { label: 'New', emoji: '🆕' },
  top: { label: 'Top', emoji: '🏆' },
};

export function SortTabs({
  value,
  onChange,
}: {
  value: SortMode;
  onChange: (v: SortMode) => void;
}) {
  return (
    <View style={{
      flexDirection: 'row',
      gap: SP['2'],
      paddingHorizontal: SP['4'],
      paddingVertical: SP['3'],
      borderBottomWidth: 1,
      borderBottomColor: C.border,
      backgroundColor: C.bg,
    }}>
      {(['hot', 'new', 'top'] as const).map((m) => {
        const active = value === m;
        return (
          <PressableScale
            key={m}
            onPress={() => onChange(m)}
            haptic="select"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: SP['1'],
              paddingHorizontal: SP['4'],
              paddingVertical: SP['2'],
              borderRadius: R.full,
              backgroundColor: active ? C.accent : C.bg3,
              borderWidth: 1,
              borderColor: active ? C.accent : C.border,
            }}
          >
            <Text style={{ fontSize: 14 }}>{LABELS[m].emoji}</Text>
            <Text style={[T.smallM, { color: active ? '#fff' : C.text2 }]}>{LABELS[m].label}</Text>
          </PressableScale>
        );
      })}
    </View>
  );
}
