import { View, Text } from 'react-native';
import { C, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import { Button } from './Button';
import type { LucideIcon } from 'lucide-react-native';

export function EmptyState({
  icon: I,
  title,
  message,
  actionLabel,
  onAction,
}: {
  icon?: LucideIcon;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={{ padding: SP['10'], alignItems: 'center', gap: SP['3'] }}>
      {I && (
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: 32,
            backgroundColor: C.bg3,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <I size={28} color={C.text2} strokeWidth={2.2} />
        </View>
      )}
      <Text style={[T.h3, { color: C.text, textAlign: 'center' }]}>{title}</Text>
      {message && (
        <Text style={[T.body, { color: C.text2, textAlign: 'center', maxWidth: 280 }]}>
          {message}
        </Text>
      )}
      {actionLabel && onAction && (
        <View style={{ marginTop: SP['3'] }}>
          <Button label={actionLabel} onPress={onAction} fullWidth={false} />
        </View>
      )}
    </View>
  );
}
