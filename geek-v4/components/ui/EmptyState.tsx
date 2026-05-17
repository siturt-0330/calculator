import { View, Text } from 'react-native';
import { C, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import { Button } from './Button';
import type { LucideIcon } from 'lucide-react-native';

type Tone = 'neutral' | 'accent' | 'amber' | 'green' | 'pink' | 'red' | 'blue';

const TONES: Record<Tone, { bg: string; fg: string }> = {
  neutral: { bg: C.bg3, fg: C.text2 },
  accent:  { bg: C.accentBg, fg: C.accent },
  amber:   { bg: C.amberBg, fg: C.amber },
  green:   { bg: C.greenBg, fg: C.green },
  pink:    { bg: C.pinkBg, fg: C.pink },
  red:     { bg: C.redBg, fg: C.red },
  blue:    { bg: C.blueBg, fg: C.blue },
};

export function EmptyState({
  icon: I,
  title,
  message,
  actionLabel,
  onAction,
  tone = 'accent',
}: {
  icon?: LucideIcon;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: Tone;
}) {
  const t = TONES[tone];
  return (
    <View style={{ padding: SP['10'], alignItems: 'center', gap: SP['3'] }}>
      {I && (
        <View
          style={{
            width: 72,
            height: 72,
            borderRadius: 36,
            backgroundColor: t.bg,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: t.fg + '33',
          }}
        >
          <I size={32} color={t.fg} strokeWidth={2} />
        </View>
      )}
      <Text style={[T.h3, { color: C.text, textAlign: 'center' }]}>{title}</Text>
      {message && (
        <Text style={[T.body, { color: C.text2, textAlign: 'center', maxWidth: 300 }]}>
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
