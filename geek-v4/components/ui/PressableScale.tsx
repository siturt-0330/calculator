import { Platform, Pressable, type PressableProps } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { PRESS_SCALE, SPRING_SNAPPY } from '../../design/motion';
import { haptic as triggerHapticPreset, type HapticKind } from '../../lib/haptics';

type Props = PressableProps & {
  haptic?: HapticKind;
  scaleValue?: number;
  children?: React.ReactNode;
  // When provided, enables long-press behavior. Fires the callback after
  // the native long-press delay along with a medium impact haptic. The
  // existing press animation is unchanged.
  onLongPress?: () => void;
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// ============================================================
// PressableScale
// ============================================================
//
// Apple Photos / Reddit Android の press feedback に寄せた spring 系の
// scale フィードバック。timing-based scale ではなく `withSpring` を使うことで、
// 押下中も release 中も同じ物理モデルで自然に動く ("ピタッ" と止まる)。
//
//   - SPRING_SNAPPY (damping 18, stiffness 300, mass 0.6) で
//     press-in / press-out 共通の spring 復元
//   - 縮小率は scaleValue prop で override 可 (default: PRESS_SCALE = 0.96)
//   - delayPressIn=0 で OS の遅延を排除 (体感応答速度 up)
//   - デフォルト hitSlop=8 で誤タップを減らす
//   - haptic は press-in で即発火 → onPress より早い体感
//   - layout を動かさないよう `transform: [{ scale }]` のみで実装
//
export function PressableScale({
  haptic,
  scaleValue = PRESS_SCALE,
  children,
  onPress,
  onPressIn,
  onPressOut,
  onLongPress,
  style,
  hitSlop,
  disabled,
  // a11y: 呼び出し側が明示してなければ "button" / disabled state を補う。
  // VoiceOver / TalkBack でフォーカス時に「ボタン」「使用不可」と読まれる。
  accessibilityRole,
  accessibilityState,
  ...rest
}: Props) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  // delayPressIn は AnimatedPressable の型に乗ってないのでキャストして渡す
  // (実際は Pressable がサポートしている — OS デフォルトの ~130ms 遅延を消す)
  //
  // Note for future maintainers:
  //   On the web target this prop is essentially a no-op — modern browsers
  //   already use FastClick semantics (the legacy 300ms touch-delay was removed
  //   years ago for viewport-meta="width=device-width" pages, which Expo Router
  //   sets by default). So no additional web-specific handling is needed here;
  //   the same `delayPressIn: 0` cast is correct on native and harmless on web.
  const extra = { delayPressIn: 0 } as Record<string, unknown>;

  // Web のみ: cursor: 'pointer' を必ず付ける。
  // RN Web の Pressable はデフォルトで cursor を変更しないため、disabled でない
  // 全ての tappable な要素は手のアイコンに変わるべき (即時の視覚フィードバック → 体感速度 up)。
  // touch device では cursor は無視されるので React Native への副作用無し。
  //
  // Web 限定で transition も付与: scale-spring の onPressOut から戻る間に opacity が
  // ほんの少し沈むのでタップフィードバックが豪華に見える。touch device には影響しない。
  const webCursorStyle =
    Platform.OS === 'web' && !disabled
      ? ({
          cursor: 'pointer',
          transition: 'opacity 120ms ease, filter 160ms ease',
          WebkitTapHighlightColor: 'transparent',
        } as Record<string, unknown>)
      : null;

  return (
    <AnimatedPressable
      {...extra}
      hitSlop={hitSlop ?? 8}
      disabled={disabled}
      accessibilityRole={accessibilityRole ?? 'button'}
      accessibilityState={{ disabled: !!disabled, ...(accessibilityState ?? {}) }}
      onPressIn={(e) => {
        // disabled の時は scale animation も haptic も発火させない (誤って反応した
        // ように見える bug を防ぐ)
        if (disabled) return;
        scale.value = withSpring(scaleValue, SPRING_SNAPPY);
        // haptic を press-in で即発火 → 体感応答速度が上がる
        if (haptic) triggerHapticPreset(haptic);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        if (disabled) return;
        scale.value = withSpring(1, SPRING_SNAPPY);
        onPressOut?.(e);
      }}
      onPress={onPress}
      onLongPress={
        onLongPress
          ? () => {
              if (disabled) return;
              // Heavy impact for the longer press gesture (pop は Heavy 固定 — lib/haptics が SoT)。
              triggerHapticPreset('pop');
              onLongPress();
            }
          : undefined
      }
      style={[animStyle, style as object, webCursorStyle as object]}
      {...rest}
    >
      {children}
    </AnimatedPressable>
  );
}
