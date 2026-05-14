import { Pressable, PressableProps } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useEffect } from 'react';
import { hap } from '@/design/haptics';
import { SPRING_TIGHT, PRESS_SCALE } from '@/design/motion';
import { C } from '@/design/tokens';
import { TABBAR } from '@/design/tabbar';

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

  return (
    <APressable
      {...rest}
      onPressIn={() => {
        scale.value = withSpring(PRESS_SCALE, SPRING_TIGHT);
      }}
      onPressOut={() => {
        scale.value = withSpring(1, SPRING_TIGHT);
      }}
      onPress={() => {
        hap.tap();
        onPress();
      }}
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
