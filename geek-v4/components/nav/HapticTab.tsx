import { Pressable, PressableProps } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useEffect } from 'react';
import { hap } from '../../design/haptics';
import { SPRING_TIGHT, SPRING_SNAP, PRESS_SCALE } from '../../design/motion';
import { C } from '../../design/tokens';
import { TABBAR } from '../../design/tabbar';

const APressable = Animated.createAnimatedComponent(Pressable);

type Props = Omit<PressableProps, 'onPress'> & {
  focused: boolean;
  onPress: () => void;
  children: React.ReactNode;
};

export function HapticTab({ focused, onPress, children, ...rest }: Props) {
  const scale = useSharedValue(1);
  const indicator = useSharedValue(focused ? 1 : 0);

  useEffect(() => {
    indicator.value = withSpring(focused ? 1 : 0, SPRING_TIGHT);
  }, [focused, indicator]);

  const aScale = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const aIndicator = useAnimatedStyle(() => ({
    opacity: indicator.value,
    transform: [{ scaleX: indicator.value }],
  }));

  // delayPressIn は AnimatedPressable の型に乗ってないのでキャストして渡す
  const extra = { delayPressIn: 0 } as Record<string, unknown>;

  return (
    <APressable
      {...rest}
      {...extra}
      onPressIn={() => {
        scale.value = withSpring(PRESS_SCALE, SPRING_SNAP);
        // press-in で即 haptic → 体感反応速度向上
        hap.tap();
      }}
      onPressOut={() => {
        scale.value = withSpring(1, SPRING_SNAP);
      }}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      style={[
        { flex: 1, alignItems: 'center', justifyContent: 'center', height: TABBAR.height },
        aScale,
      ]}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            top: 6,
            width: TABBAR.indicatorW,
            height: TABBAR.indicatorH,
            borderRadius: TABBAR.indicatorH,
            backgroundColor: C.accent,
          },
          aIndicator,
        ]}
      />
      {children}
    </APressable>
  );
}
