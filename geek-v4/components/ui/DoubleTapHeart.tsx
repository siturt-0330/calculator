import { memo, useCallback, useMemo } from 'react';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { View, Platform } from 'react-native';
import { Icon } from '../../constants/icons';
import { hap } from '../../design/haptics';
import { TIMING_FAST, SPRING_BOUNCY } from '../../design/motion';
import { C } from '../../design/tokens';

// パフォーマンス監査: フィード内で数十個の DoubleTapHeart が同時に存在し、
// スクロール時の re-render で useSharedValue/useAnimatedStyle が新規構築されると
// allocation spike → GC → frame drop。memo + stable callbacks で抑制。
function DoubleTapHeartInner({
  children,
  onDoubleTap,
  enabled = true,
}: {
  children: React.ReactNode;
  onDoubleTap: () => void;
  enabled?: boolean;
}) {
  // hooks はすべて早期 return の前に宣言する (React rules-of-hooks)
  const scale = useSharedValue(0);
  const op = useSharedValue(0);

  // hap.pop() は JS thread で実行する必要があるので、worklet からは runOnJS
  // 経由でしか呼べない。
  const fire = useCallback(() => {
    try { hap.pop(); } catch { /* ignore */ }
    onDoubleTap();
  }, [onDoubleTap]);

  const animate = useCallback(() => {
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
      // 末尾 timing の callback で fire を呼ぶ — animation 終了後に bridge
      withTiming(0, { duration: 180 }, () => {
        runOnJS(fire)();
      }),
    );
  }, [fire, scale, op]);

  const tap = useMemo(
    () => Gesture.Tap().numberOfTaps(2).maxDelay(280).enabled(enabled).onEnd(() => animate()),
    [enabled, animate],
  );

  const a = useAnimatedStyle(() => ({
    opacity: op.value,
    transform: [{ scale: scale.value }],
  }));

  // Web (= iOS Safari / Android Chrome PWA) では GestureDetector + Tap が
  // touch event を吸収して body の vertical scroll を妨げるバグがある。
  if (Platform.OS === 'web') {
    return <View style={{ position: 'relative' }}>{children}</View>;
  }

  const Heart = Icon.heart;

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

export const DoubleTapHeart = memo(DoubleTapHeartInner);
