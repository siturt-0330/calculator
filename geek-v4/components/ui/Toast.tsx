import { Text } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { SHADOW } from '../../design/shadows';
import { PressableScale } from './PressableScale';
import type { Toast as ToastType } from '../../stores/toastStore';

const BG: Record<string, string> = {
  info: C.bg3,
  success: C.greenBg,
  error: C.redBg,
  warn: C.amberBg,
};
const FG: Record<string, string> = {
  info: C.text,
  success: C.green,
  error: C.red,
  warn: C.amber,
};

// Toast item with smooth slide-down + fade in (FadeInUp 220ms) and
// slide-up + fade out (FadeOutUp 180ms). Pill-shaped with soft elevation.
export function ToastItem({ toast, onDismiss }: { toast: ToastType; onDismiss: () => void }) {
  return (
    <Animated.View
      entering={FadeInUp.duration(220)}
      exiting={FadeOutUp.duration(180)}
      style={[
        {
          marginBottom: SP['2'],
          borderRadius: R.full,
          backgroundColor: BG[toast.variant],
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: SP['4'],
          paddingVertical: SP['3'],
          gap: SP['3'],
          borderWidth: 1,
          borderColor: C.border,
          ...SHADOW.card,
        },
      ]}
    >
      <Text style={[T.bodyM, { flex: 1, color: FG[toast.variant] }]}>{toast.message}</Text>
      {toast.undoLabel && toast.onUndo && (
        <PressableScale onPress={() => { toast.onUndo?.(); onDismiss(); }} haptic="tap">
          <Text style={[T.smallM, { color: C.accent }]}>{toast.undoLabel}</Text>
        </PressableScale>
      )}
    </Animated.View>
  );
}
