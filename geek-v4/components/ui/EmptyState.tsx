import { useEffect, type ComponentType } from 'react';
import { View, Text } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSpring,
  Easing,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import type { LucideIcon } from 'lucide-react-native';
import { SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { Button } from './Button';
import { useColors, useGradients, useShadows } from '../../hooks/useColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';

// ============================================================
// EmptyState — 「気持ちのいい空っぽ」
// ------------------------------------------------------------
//   - 96x96 gradient circle に icon / emoji を float
//   - mount 時に opacity / translateY / scale で 60ms stagger 入場
//   - reduceMotion=true ならアニメは skip して即表示
//   - tone は既存 7-tone を維持 (backward compat)
// ============================================================

type Tone = 'neutral' | 'accent' | 'amber' | 'green' | 'pink' | 'red' | 'blue';

// Reanimated 3 標準の入場 timing
const FADE_MS = 250;
const TRANSLATE_MS = 300;
const SCALE_DAMPING = 14;
const SCALE_STIFFNESS = 180;
const STAGGER_MS = 60;

type Props = {
  /** Lucide icon または同形の component。指定すると circle 内に white で描画 */
  icon?: LucideIcon | ComponentType<{ size: number; color: string; strokeWidth?: number }>;
  /** Emoji を渡すと icon より優先して 44pt で float */
  emoji?: string;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** tone は既存呼び出し側互換のため 7-tone 維持 */
  tone?: Tone;
};

export function EmptyState({
  icon: IconComp,
  emoji,
  title,
  message,
  actionLabel,
  onAction,
  tone: _tone = 'accent',
}: Props) {
  const C = useColors();
  const GRAD = useGradients();
  const SHADOW = useShadows();
  const reduceMotion = useReducedMotion();

  // 入場アニメ — circle / title / message / CTA の 4 要素を stagger
  const circleOpacity = useSharedValue(reduceMotion ? 1 : 0);
  const circleScale = useSharedValue(reduceMotion ? 1 : 0.8);
  const titleOpacity = useSharedValue(reduceMotion ? 1 : 0);
  const titleTranslateY = useSharedValue(reduceMotion ? 0 : 12);
  const messageOpacity = useSharedValue(reduceMotion ? 1 : 0);
  const messageTranslateY = useSharedValue(reduceMotion ? 0 : 12);
  const ctaOpacity = useSharedValue(reduceMotion ? 1 : 0);
  const ctaTranslateY = useSharedValue(reduceMotion ? 0 : 12);

  useEffect(() => {
    if (reduceMotion) return;

    // emoji circle: scale spring + opacity timing
    circleOpacity.value = withTiming(1, { duration: FADE_MS, easing: Easing.out(Easing.ease) });
    circleScale.value = withSpring(1, {
      damping: SCALE_DAMPING,
      stiffness: SCALE_STIFFNESS,
      mass: 1,
    });

    // title — stagger 1
    titleOpacity.value = withDelay(
      STAGGER_MS,
      withTiming(1, { duration: FADE_MS, easing: Easing.out(Easing.ease) }),
    );
    titleTranslateY.value = withDelay(
      STAGGER_MS,
      withTiming(0, { duration: TRANSLATE_MS, easing: Easing.out(Easing.quad) }),
    );

    // message — stagger 2
    messageOpacity.value = withDelay(
      STAGGER_MS * 2,
      withTiming(1, { duration: FADE_MS, easing: Easing.out(Easing.ease) }),
    );
    messageTranslateY.value = withDelay(
      STAGGER_MS * 2,
      withTiming(0, { duration: TRANSLATE_MS, easing: Easing.out(Easing.quad) }),
    );

    // CTA — stagger 3
    ctaOpacity.value = withDelay(
      STAGGER_MS * 3,
      withTiming(1, { duration: FADE_MS, easing: Easing.out(Easing.ease) }),
    );
    ctaTranslateY.value = withDelay(
      STAGGER_MS * 3,
      withTiming(0, { duration: TRANSLATE_MS, easing: Easing.out(Easing.quad) }),
    );
  }, [
    reduceMotion,
    circleOpacity,
    circleScale,
    titleOpacity,
    titleTranslateY,
    messageOpacity,
    messageTranslateY,
    ctaOpacity,
    ctaTranslateY,
  ]);

  const circleStyle = useAnimatedStyle(() => ({
    opacity: circleOpacity.value,
    transform: [{ scale: circleScale.value }],
  }));
  const titleStyle = useAnimatedStyle(() => ({
    opacity: titleOpacity.value,
    transform: [{ translateY: titleTranslateY.value }],
  }));
  const messageStyle = useAnimatedStyle(() => ({
    opacity: messageOpacity.value,
    transform: [{ translateY: messageTranslateY.value }],
  }));
  const ctaStyle = useAnimatedStyle(() => ({
    opacity: ctaOpacity.value,
    transform: [{ translateY: ctaTranslateY.value }],
  }));

  const hasVisual = !!emoji || !!IconComp;

  return (
    <View style={{ padding: SP['10'], alignItems: 'center', gap: SP['4'] }}>
      {hasVisual && (
        // 96x96 gradient circle — 紫 → ピンク のブランドグラデ + soft halo。
        // emoji があれば 44pt で float、なければ icon を white 36pt で描画。
        // ★ wrapper にも円と同じ radius を付ける — web では shadow が box-shadow に
        //   変換され要素の矩形に沿うため、radius 無しだと丸アイコンの背後に
        //   四角い halo (ライトテーマで白っぽい正方形) が浮いて見える。
        <Animated.View style={[circleStyle, { borderRadius: 48 }, SHADOW.glow]}>
          <LinearGradient
            colors={[...GRAD.primary]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              width: 96,
              height: 96,
              borderRadius: 48,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {emoji ? (
              // emoji は 44pt — gradient 上に「浮いている」見せ方
              <Text
                style={{
                  fontSize: 44,
                  lineHeight: 52,
                  textAlign: 'center',
                }}
                accessibilityElementsHidden
                importantForAccessibility="no"
              >
                {emoji}
              </Text>
            ) : IconComp ? (
              <IconComp size={36} color="#ffffff" strokeWidth={1.8} />
            ) : null}
          </LinearGradient>
        </Animated.View>
      )}

      <Animated.Text
        style={[
          T.h3,
          {
            color: C.text,
            textAlign: 'center',
            letterSpacing: -0.3,
            fontWeight: '700',
            marginTop: SP['1'],
          },
          titleStyle,
        ]}
      >
        {title}
      </Animated.Text>

      {message && (
        <Animated.Text
          style={[
            T.body,
            {
              color: C.text2,
              textAlign: 'center',
              maxWidth: 320,
              lineHeight: 22,
            },
            messageStyle,
          ]}
        >
          {message}
        </Animated.Text>
      )}

      {actionLabel && onAction && (
        // wrapper に Button と同じ radius (12) — radius 無しの wrapper に glow を
        // 付けると web で四角い影が CTA の背後に出る (上の circle と同じ理屈)
        <Animated.View style={[{ marginTop: SP['3'], borderRadius: 12 }, SHADOW.glow, ctaStyle]}>
          <Button label={actionLabel} onPress={onAction} variant="primary" fullWidth={false} />
        </Animated.View>
      )}
    </View>
  );
}
