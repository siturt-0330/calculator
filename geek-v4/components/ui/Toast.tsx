import { View, Text } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useEffect } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, R, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import { SHADOW } from '@/design/shadows';
import { SPRING_BOUNCY } from '@/design/motion';
import { PressableScale } from './PressableScale';
import type { Toast as ToastType } from '@/stores/toastStore';

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

export function ToastItem({ toast, onDismiss }: { toast: ToastType; onDismiss: () => void }) {
  const y = useSharedValue(-80);
  const op = useSharedValue(0);
  const a = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }],
    opacity: op.value,
  }));

  useEffect(() => {
    y.value = withSpring(0, SPRING_BOUNCY);
    op.value = withTiming(1, { duration: 160 });
  }, [y, op]);

  return (
    <Animated.View
      style={[
        {
          marginBottom: SP['2'],
          borderRadius: R.lg,
          backgroundColor: BG[toast.variant],
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: SP['4'],
          paddingVertical: SP['3'],
          gap: SP['3'],
          borderWidth: 1,
          borderColor: C.border,
          ...SHADOW.pill,
        },
        a,
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
