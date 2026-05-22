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
import { View } from 'react-native';
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
  // useSharedValue は parent re-render で値リセットされないので大丈夫だが、
  // useMemo でラップして reference 安定化 → useAnimatedStyle が無駄に再構築
  // されない保険にする。
  const scale = useSharedValue(0);
  const op = useSharedValue(0);
  const Heart = Icon.heart;

  // hap.pop() は JS thread で実行する必要があるので、worklet からは runOnJS
  // 経由でしか呼べない。アニメーション終了 callback の中で発火すると、
  // worklet → JS bridge が animation tick 内で同期評価されて GC を巻き込む。
  // op.value の最終 withTiming の completion callback で呼ぶことで bridge が
  // animation 終了後に走るようにし、scroll 中の jank を回避。
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
