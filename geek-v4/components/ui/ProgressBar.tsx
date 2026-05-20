import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useEffect } from 'react';
import { C, R } from '../../design/tokens';
import { SPRING_GENTLE } from '../../design/motion';

export function ProgressBar({
  value,
  height = 4,
  color = C.accent,
}: {
  value: number; // 0-100
  height?: number;
  color?: string;
}) {
  const width = useSharedValue(0);
  useEffect(() => {
    width.value = withSpring(Math.min(Math.max(value, 0), 100), SPRING_GENTLE);
  }, [value, width]);
  const a = useAnimatedStyle(() => ({ width: `${width.value}%` as const }));

  return (
    <View
      style={{
        height,
        borderRadius: R.full,
        backgroundColor: C.bg3,
        overflow: 'hidden',
      }}
    >
      <Animated.View
        style={[{ height: '100%', borderRadius: R.full, backgroundColor: color }, a]}
      />
    </View>
  );
}
