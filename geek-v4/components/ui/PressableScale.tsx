import { Pressable, type PressableProps } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { PRESS_SCALE } from '@/design/motion';
import { SPRING_TIGHT } from '@/design/motion';

type HapticType = 'tap' | 'select' | 'pop' | 'confirm' | 'success' | 'warn' | 'error';

type Props = PressableProps & {
  haptic?: HapticType;
  scaleValue?: number;
  children?: React.ReactNode;
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function PressableScale({ haptic, scaleValue = PRESS_SCALE, children, onPress, style, ...rest }: Props) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  function triggerHaptic(type: HapticType) {
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

  return (
    <AnimatedPressable
      onPressIn={() => { scale.value = withSpring(scaleValue, SPRING_TIGHT); }}
      onPressOut={() => { scale.value = withSpring(1, SPRING_TIGHT); }}
      onPress={(e) => {
        if (haptic) triggerHaptic(haptic);
        onPress?.(e);
      }}
      style={[animStyle, style as object]}
      {...rest}
    >
      {children}
    </AnimatedPressable>
  );
}
