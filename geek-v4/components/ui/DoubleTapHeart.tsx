import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { View } from 'react-native';
import { Icon } from '../../constants/icons';
import { hap } from '../../design/haptics';
import { TIMING_FAST, SPRING_BOUNCY } from '../../design/motion';
import { C } from '../../design/tokens';

export function DoubleTapHeart({
  children,
  onDoubleTap,
  enabled = true,
}: {
  children: React.ReactNode;
  onDoubleTap: () => void;
  enabled?: boolean;
}) {
  const scale = useSharedValue(0);
  const op = useSharedValue(0);
  const Heart = Icon.heart;

  const fire = () => {
    hap.pop();
    onDoubleTap();
  };

  const animate = () => {
    'worklet';
    scale.value = 0;
    op.value = 0;
    scale.value = withSequence(
      withSpring(1.2, SPRING_BOUNCY),
      withTiming(1.0, TIMING_FAST),
      withTiming(0, { duration: 240 }),
    );
    op.value = withSequence(
      withTiming(1, { duration: 80 }),
      withTiming(1, { duration: 240 }),
      withTiming(0, { duration: 180 }),
    );
    runOnJS(fire)();
  };

  const tap = Gesture.Tap().numberOfTaps(2).maxDelay(280).enabled(enabled).onEnd(() => animate());
  const a = useAnimatedStyle(() => ({
    opacity: op.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={tap}>
      <View style={{ position: 'relative' }}>
        {children}
        <Animated.View
          pointerEvents="none"
          style={[{ position: 'absolute', alignSelf: 'center', top: '40%' }, a]}
        >
          <Heart size={96} color="#fff" fill={C.accent} strokeWidth={1.5} />
        </Animated.View>
      </View>
    </GestureDetector>
  );
}
