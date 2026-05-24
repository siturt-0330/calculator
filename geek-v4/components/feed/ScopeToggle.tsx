import { View, Text } from 'react-native';
import { PressableScale } from '../ui/PressableScale';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import type { FeedScope } from '../../stores/feedStore';

export function ScopeToggle({
  value,
  onChange,
  disabledClosed,
  onClosedWhenEmpty,
}: {
  value: FeedScope;
  onChange: (v: FeedScope) => void;
  disabledClosed?: boolean;  // closed (好きだけ) を視覚的にハイライト解除
  onClosedWhenEmpty?: () => void;  // disabledClosed 時に closed を押したら呼ばれる
}) {
  return (
    <View style={{
      flexDirection: 'row',
      backgroundColor: C.bg3,
      borderRadius: R.full,
      padding: 3,
      borderWidth: 1,
      borderColor: C.border,
    }}>
      {(
        [
          { v: 'open', label: 'すべて', sub: '全部' },
          { v: 'closed', label: '選択した # のみ', sub: '好きだけ' },
        ] as const
      ).map((m) => {
        const active = value === m.v;
        const dimmed = disabledClosed && m.v === 'closed';
        const handlePress = () => {
          if (dimmed && onClosedWhenEmpty) onClosedWhenEmpty();
          else onChange(m.v);
        };
        return (
          <PressableScale
            key={m.v}
            onPress={handlePress}
            haptic="select"
            style={{
              flex: 1,
              paddingVertical: SP['2'],
              paddingHorizontal: SP['3'],
              borderRadius: R.full,
              backgroundColor: active && !dimmed ? C.accent : 'transparent',
              alignItems: 'center',
              opacity: dimmed ? 0.55 : 1,
            }}
          >
            <Text style={[T.smallM, { color: active && !dimmed ? '#fff' : C.text2 }]}>{m.label}</Text>
          </PressableScale>
        );
      })}
    </View>
  );
}
