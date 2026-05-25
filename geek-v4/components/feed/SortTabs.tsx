import { View, Text } from 'react-native';
import { PressableScale } from '../ui/PressableScale';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { useT } from '../../lib/i18n';
import type { SortMode } from '../../lib/api/posts';

// label は ja 文字列を直接書いて、表示時に useT で翻訳。DICT 側で en/zh/ko/es/fr 対応済。
const ORDER: ReadonlyArray<{ v: SortMode; label: string }> = [
  { v: 'for-you', label: 'あなた向け' },
  { v: 'new', label: '新着' },
  { v: 'hot', label: '急上昇' },
  { v: 'top', label: '人気' },
];

export function SortTabs({
  value,
  onChange,
}: {
  value: SortMode;
  onChange: (v: SortMode) => void;
}) {
  const t = useT();
  return (
    <View style={{
      flexDirection: 'row',
      backgroundColor: C.bg3,
      borderRadius: R.full,
      padding: 3,
      borderWidth: 1,
      borderColor: C.border,
    }}>
      {ORDER.map((m) => {
        const active = value === m.v;
        return (
          <PressableScale
            key={m.v}
            onPress={() => onChange(m.v)}
            haptic="select"
            style={{
              flex: 1,
              paddingVertical: SP['2'],
              paddingHorizontal: SP['2'],
              borderRadius: R.full,
              backgroundColor: active ? C.accent : 'transparent',
              alignItems: 'center',
            }}
          >
            <Text
              style={[
                T.smallM,
                {
                  color: active ? '#fff' : C.text2,
                  fontWeight: active ? '700' : '500',
                },
              ]}
            >
              {t(m.label)}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}
