import { View, Text } from 'react-native';
import { PressableScale } from './PressableScale';
import { Divider } from './Divider';
import { C, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import type { LucideIcon } from 'lucide-react-native';

export type Action = {
  label: string;
  icon?: LucideIcon;
  onPress: () => void;
  destructive?: boolean;
};

export function ActionSheet({
  title,
  actions,
  onClose,
}: {
  title?: string;
  actions: Action[];
  onClose?: () => void;
}) {
  return (
    <View style={{ paddingHorizontal: SP['4'], paddingTop: SP['2'], paddingBottom: SP['8'] }}>
      {title && (
        <Text style={[T.smallM, { color: C.text3, marginBottom: SP['3'] }]}>{title}</Text>
      )}
      {actions.map((a, i) => (
        <View key={a.label}>
          <PressableScale
            onPress={() => { a.onPress(); onClose?.(); }}
            haptic={a.destructive ? 'warn' : 'tap'}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: SP['3'],
              paddingVertical: SP['4'],
            }}
          >
            {a.icon && (
              <a.icon
                size={22}
                color={a.destructive ? C.red : C.text}
                strokeWidth={2.2}
              />
            )}
            <Text
              style={[T.body, { color: a.destructive ? C.red : C.text, flex: 1 }]}
            >
              {a.label}
            </Text>
          </PressableScale>
          {i < actions.length - 1 && <Divider />}
        </View>
      ))}
    </View>
  );
}
