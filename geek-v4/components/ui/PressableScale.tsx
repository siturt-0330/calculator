import { Platform, Pressable, type PressableProps } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { PRESS_SCALE, SPRING_SNAP } from '../../design/motion';

type HapticType = 'tap' | 'select' | 'pop' | 'confirm' | 'success' | 'warn' | 'error';

type Props = PressableProps & {
  haptic?: HapticType;
  scaleValue?: number;
  children?: React.ReactNode;
  // When provided, enables long-press behavior. Fires the callback after
  // the native long-press delay along with a medium impact haptic. The
  // existing press animation is unchanged.
  onLongPress?: () => void;
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// より反応の良い press-feedback に調整した PressableScale。
// - SPRING_SNAP (stiffness 400, damping 14) で press-in→onPress の体感ラグを短く
// - delayPressIn=0 で OS の遅延を排除
// - デフォルト hitSlop=8 で誤タップを減らす
// - haptic は press-in で即発火 (onPress 時より早い)
export function PressableScale({
  haptic,
  scaleValue = PRESS_SCALE,
  children,
  onPress,
  onPressIn,
  onPressOut,
  onLongPress,
  style,
  hitSlop,
  disabled,
  ...rest
}: Props) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  function triggerHaptic(type: HapticType) {
    if (Platform.OS === 'web') return;
    try {
      switch (type) {
        case 'tap': Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); break;
        case 'select': Haptics.selectionAsync(); break;
        case 'pop': Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); break;
        case 'confirm': Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); break;
        case 'success': Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); break;
        case 'warn': Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); break;
        case 'error': Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); break;
      }
    } catch {}
  }

  // delayPressIn は AnimatedPressable の型に乗ってないのでキャストして渡す
  // (実際は Pressable がサポートしている — OS デフォルトの ~130ms 遅延を消す)
  //
  // Note for future maintainers:
  //   On the web target this prop is essentially a no-op — modern browsers
  //   already use FastClick semantics (the legacy 300ms touch-delay was removed
  //   years ago for viewport-meta="width=device-width" pages, which Expo Router
  //   sets by default). So no additional web-specific handling is needed here;
  //   the same `delayPressIn: 0` cast is correct on native and harmless on web.
  const extra = { delayPressIn: 0 } as Record<string, unknown>;

  // Web のみ: cursor: 'pointer' を必ず付ける。
  // RN Web の Pressable はデフォルトで cursor を変更しないため、disabled でない
  // 全ての tappable な要素は手のアイコンに変わるべき (即時の視覚フィードバック → 体感速度 up)。
  // touch device では cursor は無視されるので React Native への副作用無し。
  const webCursorStyle =
    Platform.OS === 'web' && !disabled
      ? ({ cursor: 'pointer' } as Record<string, unknown>)
      : null;

  return (
    <AnimatedPressable
      {...extra}
      hitSlop={hitSlop ?? 8}
      disabled={disabled}
      onPressIn={(e) => {
        // disabled の時は scale animation も haptic も発火させない (誤って反応した
        // ように見える bug を防ぐ)
        if (disabled) return;
        scale.value = withSpring(scaleValue, SPRING_SNAP);
        // haptic を press-in で即発火 → 体感応答速度が上がる
        if (haptic) triggerHaptic(haptic);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        if (disabled) return;
        scale.value = withSpring(1, SPRING_SNAP);
        onPressOut?.(e);
      }}
      onPress={onPress}
      onLongPress={
        onLongPress
          ? () => {
              if (disabled) return;
              // Medium impact for the longer press gesture.
              if (Platform.OS !== 'web') {
                try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}
              }
              onLongPress();
            }
          : undefined
      }
      style={[animStyle, style as object, webCursorStyle as object]}
      {...rest}
    >
      {children}
    </AnimatedPressable>
  );
}
