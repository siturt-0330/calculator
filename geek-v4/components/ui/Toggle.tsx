import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useEffect } from 'react';
import { PressableScale } from './PressableScale';
import { C } from '../../design/tokens';
import { SPRING_TIGHT } from '../../design/motion';

export function Toggle({
  value,
  onChange,
  disabled,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const x = useSharedValue(value ? 22 : 2);
  useEffect(() => {
    x.value = withSpring(value ? 22 : 2, SPRING_TIGHT);
  }, [value, x]);
  const a = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <PressableScale
      onPress={() => onChange(!value)}
      disabled={disabled}
      haptic="select"
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      style={{
        width: 48,
        height: 28,
        borderRadius: 14,
        padding: 2,
        backgroundColor: value ? C.accent : C.bg4,
        justifyContent: 'center',
      }}
    >
      <Animated.View
        style={[{ width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff' }, a]}
      />
    </PressableScale>
  );
}
