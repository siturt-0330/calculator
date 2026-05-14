import { View, Text } from 'react-native';
import { C, R, SP } from '@/design/tokens';
import { T } from '@/design/typography';

type Variant = 'accent' | 'green' | 'amber' | 'red' | 'gray';
const COLORS: Record<Variant, { bg: string; fg: string }> = {
  accent: { bg: C.accentBg, fg: C.accentLight },
  green: { bg: C.greenBg, fg: C.green },
  amber: { bg: C.amberBg, fg: C.amber },
  red: { bg: C.redBg, fg: C.red },
  gray: { bg: C.bg3, fg: C.text2 },
};

export function Badge({ label, variant = 'accent' }: { label: string; variant?: Variant }) {
  const c = COLORS[variant];
  return (
    <View
      style={{
        paddingHorizontal: SP['2'],
        paddingVertical: 2,
        borderRadius: R.full,
        backgroundColor: c.bg,
      }}
    >
      <Text style={[T.captionM, { color: c.fg }]}>{label}</Text>
    </View>
  );
}
