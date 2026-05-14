import { View, Text } from 'react-native';
import { PressableScale } from './PressableScale';
import { Icon } from '@/constants/icons';
import { C, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import type { LucideIcon } from 'lucide-react-native';

export function ListItem({
  label,
  sublabel,
  icon: I,
  right,
  onPress,
  destructive,
}: {
  label: string;
  sublabel?: string;
  icon?: LucideIcon;
  right?: React.ReactNode;
  onPress?: () => void;
  destructive?: boolean;
}) {
  const ChevronR = Icon.chevronR;
  const color = destructive ? C.red : C.text;

  const inner = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: SP['4'],
        paddingVertical: SP['3'],
        gap: SP['3'],
      }}
    >
      {I && <I size={20} color={destructive ? C.red : C.text2} strokeWidth={2.2} />}
      <View style={{ flex: 1 }}>
        <Text style={[T.body, { color }]}>{label}</Text>
        {sublabel && <Text style={[T.small, { color: C.text3 }]}>{sublabel}</Text>}
      </View>
      {right ?? (onPress && <ChevronR size={18} color={C.text3} strokeWidth={2.2} />)}
    </View>
  );

  if (onPress) {
    return <PressableScale onPress={onPress}>{inner}</PressableScale>;
  }
  return inner;
}
