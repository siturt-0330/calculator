// ============================================================
// PostSuccessCelebration — 投稿成功の「上質でかっこいい」確認演出
// ------------------------------------------------------------
// 旧: hap.success() + 素の toast「投稿しました」だけ。
// 新: 画面中央に
//   1) ブランドグラデのリング (spring で弾む scale-in)
//   2) その中で ✓ が pop (少し遅れて spring)
//   3) リングから 1 本の ripple が広がってフェード
//   4) 「投稿しました」が下からふわっと上がってフェードイン
//   → 約 0.9s ホールド後に全体フェードアウト → onDone() で feed へ遷移。
//
// 設計:
//   - テーマ追従 (useTheme): dark=紫グラデ+暗い半透明背景 / light=チャコール
//     グラデ+フロスト白背景。✓ は常に白。文字は C.text (背景に追従して可読)。
//   - reduceMotion: spring/ripple を止め、フェードのみ・短め。
//   - transform / opacity のみ (UI スレッド worklet・60fps)。
//   - この演出が走っている ~1s の裏で feed の refetch が完走するので、
//     「待たされ感」を出さずに新着が反映された feed を見せられる。
// ============================================================
import { useEffect } from 'react';
import { View, Modal, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withDelay,
  withSequence,
  interpolate,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Icon } from '../../constants/icons';
import { T } from '../../design/typography';
import { SP } from '../../design/tokens';
import { useTheme } from '../../hooks/useColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';

const RING = 104;
// ✓ 出現後にホールドする時間 (ms)。これ + 立ち上がり後にフェードアウト。
const HOLD_MS = 640;

export function PostSuccessCelebration({
  visible,
  onDone,
  label = '投稿しました',
}: {
  visible: boolean;
  /** フェードアウト完了時に呼ばれる (ここで feed へ遷移する)。 */
  onDone: () => void;
  label?: string;
}) {
  const { C, GRAD, SHADOW, isDark } = useTheme();
  const reduce = useReducedMotion();

  // 背景は theme に追従 — dark=暗い半透明 / light=フロスト白。✓ と文字が両方で映える。
  const backdropColor = isDark ? 'rgba(0,0,0,0.72)' : 'rgba(255,255,255,0.9)';

  const backdrop = useSharedValue(0);
  const ringScale = useSharedValue(0.6);
  const ringOpacity = useSharedValue(0);
  const checkScale = useSharedValue(0);
  const rippleP = useSharedValue(0); // 0→1 で拡大
  const rippleO = useSharedValue(0);
  const textY = useSharedValue(12);
  const textO = useSharedValue(0);
  const container = useSharedValue(1); // 全体フェードアウト用

  useEffect(() => {
    if (!visible) return;
    const RM = reduce;

    // reset
    backdrop.value = 0;
    ringScale.value = RM ? 1 : 0.6;
    ringOpacity.value = 0;
    checkScale.value = 0;
    rippleP.value = 0;
    rippleO.value = 0;
    textY.value = RM ? 0 : 12;
    textO.value = 0;
    container.value = 1;

    backdrop.value = withTiming(1, { duration: RM ? 0 : 180, easing: Easing.out(Easing.quad) });
    ringOpacity.value = withTiming(1, { duration: RM ? 0 : 160 });
    ringScale.value = RM
      ? withTiming(1, { duration: 0 })
      : withSpring(1, { damping: 12, stiffness: 200, mass: 0.7 });
    checkScale.value = withDelay(
      RM ? 0 : 130,
      RM ? withTiming(1, { duration: 0 }) : withSpring(1, { damping: 10, stiffness: 240, mass: 0.55 }),
    );
    if (!RM) {
      rippleP.value = withDelay(130, withTiming(1, { duration: 640, easing: Easing.out(Easing.cubic) }));
      rippleO.value = withDelay(
        130,
        withSequence(
          withTiming(0.45, { duration: 90 }),
          withTiming(0, { duration: 560, easing: Easing.out(Easing.quad) }),
        ),
      );
    }
    textO.value = withDelay(RM ? 0 : 250, withTiming(1, { duration: RM ? 0 : 220 }));
    textY.value = withDelay(
      RM ? 0 : 250,
      RM ? withTiming(0, { duration: 0 }) : withSpring(0, { damping: 14, stiffness: 180 }),
    );

    // 立ち上がり (~ RM?0:300) + ホールド後にフェードアウト → 完了で onDone。
    const leadIn = RM ? 0 : 300;
    container.value = withDelay(
      leadIn + HOLD_MS,
      withTiming(0, { duration: RM ? 140 : 280, easing: Easing.in(Easing.quad) }, (finished) => {
        if (finished) runOnJS(onDone)();
      }),
    );
    // visible の立ち上がりエッジでのみ起動 (reduce はマウント時点で確定)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const aBackdrop = useAnimatedStyle(() => ({ opacity: backdrop.value * container.value }));
  const aContainer = useAnimatedStyle(() => ({ opacity: container.value }));
  const aRing = useAnimatedStyle(() => ({
    opacity: ringOpacity.value,
    transform: [{ scale: ringScale.value }],
  }));
  const aCheck = useAnimatedStyle(() => ({ transform: [{ scale: checkScale.value }] }));
  const aRipple = useAnimatedStyle(() => ({
    opacity: rippleO.value,
    transform: [{ scale: interpolate(rippleP.value, [0, 1], [0.85, 2.2]) }],
  }));
  const aText = useAnimatedStyle(() => ({
    opacity: textO.value,
    transform: [{ translateY: textY.value }],
  }));

  if (!visible) return null;

  return (
    <Modal transparent visible={visible} animationType="none" statusBarTranslucent>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: backdropColor }, aBackdrop]}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { alignItems: 'center', justifyContent: 'center', gap: SP['5'] },
          aContainer,
        ]}
      >
        <View style={{ width: RING, height: RING, alignItems: 'center', justifyContent: 'center' }}>
          {/* 広がる ripple (1 本・上品に) */}
          <Animated.View
            style={[
              {
                position: 'absolute',
                width: RING,
                height: RING,
                borderRadius: RING / 2,
                borderWidth: 2,
                borderColor: C.accentLight,
              },
              aRipple,
            ]}
          />
          {/* ブランドグラデのリング + ✓ */}
          <Animated.View
            style={[
              {
                width: RING,
                height: RING,
                borderRadius: RING / 2,
                overflow: 'hidden',
                alignItems: 'center',
                justifyContent: 'center',
              },
              SHADOW.glow,
              aRing,
            ]}
          >
            <LinearGradient
              colors={[...GRAD.primary]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <Animated.View style={aCheck}>
              <Icon.check size={48} color="#ffffff" strokeWidth={3} />
            </Animated.View>
          </Animated.View>
        </View>

        <Animated.Text style={[T.h2, { color: C.text, fontWeight: '800', letterSpacing: -0.3 }, aText]}>
          {label}
        </Animated.Text>
      </Animated.View>
    </Modal>
  );
}
