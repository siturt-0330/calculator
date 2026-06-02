import { Platform, Pressable, Text, ActivityIndicator, type ViewStyle, type TextStyle } from 'react-native';
import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { SP } from '../../design/tokens';
import { SPRING_SNAPPY } from '../../design/motion';
import { useColors, useGradients, useShadows } from '../../hooks/useColors';
import { hapticPresets } from '../../lib/haptics';

// ============================================================
// Button — iOS-native 風の共通 CTA
// ============================================================
//
// - Reanimated 3 useSharedValue + useAnimatedStyle で press-in/out spring scale (0.97)
// - haptic は press-in で variant に応じて発火:
//     primary     → light
//     destructive → warning
//     success     → success
//     その他      → light (体感を統一)
// - disabled: opacity 0.5 / pointerEvents 無効化
// - loading:  ActivityIndicator が label を replace
// - radius 12 / 高さ 50 (lg) / 44 (md) / 36 (sm)
// - font: SF Pro 風 system stack (semibold)
//
// 既存 API ('primary' | 'secondary' | 'ghost' | 'danger') は後方互換のため維持。
// `danger` は内部的に `destructive` と同じ扱い (haptic も warning に揃える)。

type LegacyVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type NewVariant = 'destructive' | 'success';
type Variant = LegacyVariant | NewVariant;
type Size = 'sm' | 'md' | 'lg';
type HapticOverride = 'tap' | 'select' | 'pop' | 'confirm' | 'success' | 'warn' | 'error';

type Props = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  fullWidth?: boolean;
  /**
   * 明示的に haptic 種別を override する場合のみ指定。
   * 未指定なら variant から自動で決まる (primary=light / destructive=warning / success=success / 他=light)。
   */
  haptic?: HapticOverride;
  icon?: LucideIcon | ComponentType<{ size: number; color: string; strokeWidth: number }>;
};

// 高さ — task spec の 50/44/36 に合わせる
const HEIGHT: Record<Size, number> = { sm: 36, md: 44, lg: 50 };
const PX: Record<Size, number> = { sm: SP['4'], md: SP['5'], lg: SP['6'] };
const FONT_SIZE: Record<Size, number> = { sm: 13, md: 15, lg: 17 };

// task spec 「radius 12」を厳守 (R.lg = 14 とは別値)
const RADIUS = 12;
// task spec 「spring scale 0.97」(PressableScale の 0.96 とは別)
const PRESS_SCALE = 0.97;

// SF Pro 風 font stack — iOS は System (= SF Pro), Web は -apple-system stack, Android は近似
const SF_PRO_FONT = Platform.select({
  ios: 'System',
  android: 'Inter_600SemiBold',
  web: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Inter, sans-serif',
  default: 'Inter_600SemiBold',
}) as string;

// variant → haptic 種別 (presetKey)
function hapticForVariant(variant: Variant): keyof typeof hapticPresets {
  if (variant === 'destructive' || variant === 'danger') return 'warning';
  if (variant === 'success') return 'success';
  // primary / secondary / ghost — primary は light、それ以外も light で体感統一
  return 'light';
}

// 明示 haptic override → preset key
function presetFromOverride(o: HapticOverride): keyof typeof hapticPresets {
  switch (o) {
    case 'tap':
    case 'select':
      return 'light';
    case 'pop':
    case 'confirm':
      return 'medium';
    case 'success':
      return 'success';
    case 'warn':
      return 'warning';
    case 'error':
      return 'error';
  }
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  loading,
  disabled,
  style,
  fullWidth,
  haptic,
  icon: IconComp,
}: Props) {
  const height = HEIGHT[size];
  const px = PX[size];
  const fontSize = FONT_SIZE[size];
  const isDisabled = !!(disabled || loading);
  const opacity = isDisabled ? 0.5 : 1;

  // テーマ購読 — secondary / danger / destructive / success 背景色がライト/ダーク両対応
  const C = useColors();
  const GRAD = useGradients();
  const SHADOW = useShadows();

  // ----- color resolution -----
  // gradient (LinearGradient) で塗る variant: primary / success / destructive
  // 単色塗り: secondary
  // 透明: ghost
  // legacy `danger` は destructive と同じ扱い
  const usesGradient = variant === 'primary' || variant === 'success' || variant === 'destructive' || variant === 'danger';

  const textColor: string =
    variant === 'ghost'
      ? C.accent
      : variant === 'secondary'
        ? C.text
        : // gradient variants は全て白文字
          '#fff';

  // ----- spring scale (Reanimated 3 worklet) -----
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  // ----- haptic resolution -----
  const presetKey: keyof typeof hapticPresets = haptic
    ? presetFromOverride(haptic)
    : hapticForVariant(variant);

  const onPressInHandler = () => {
    if (isDisabled) return;
    scale.value = withSpring(PRESS_SCALE, SPRING_SNAPPY);
    hapticPresets[presetKey]();
  };
  const onPressOutHandler = () => {
    if (isDisabled) return;
    scale.value = withSpring(1, SPRING_SNAPPY);
  };

  // ----- gradient colors per variant -----
  // disabled 時は glow を落として "押せない" 感を出す
  const primaryGlow = usesGradient && !isDisabled ? SHADOW.accentGlow : null;
  const gradientColors: readonly [string, string] | null = usesGradient
    ? variant === 'success'
      ? GRAD.success
      : variant === 'destructive' || variant === 'danger'
        ? GRAD.destructive
        : // primary
          ([C.accent, C.accentDeep] as const)
    : null;

  // ----- container -----
  const containerStyle: ViewStyle = {
    height,
    paddingHorizontal: px,
    borderRadius: RADIUS,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: SP['2'],
    opacity,
    ...(fullWidth ? { alignSelf: 'stretch' } : { alignSelf: 'flex-start' }),
    ...(variant === 'secondary' ? { backgroundColor: C.bg3 } : {}),
    ...(variant === 'ghost' ? { backgroundColor: 'transparent' } : {}),
    ...(primaryGlow ?? {}),
    ...(style ?? {}),
  };

  const textStyle: TextStyle = {
    fontFamily: SF_PRO_FONT,
    fontSize,
    fontWeight: '600',
    letterSpacing: 0.2,
    color: textColor,
  };

  // a11y
  const a11yProps = {
    accessibilityRole: 'button' as const,
    accessibilityLabel: label,
    accessibilityState: { disabled: isDisabled, busy: !!loading },
  };

  // Web のみ cursor: pointer (タップ感の明示)
  const webCursorStyle: ViewStyle | null =
    Platform.OS === 'web' && !isDisabled
      ? ({
          cursor: 'pointer',
          transition: 'opacity 120ms ease',
          WebkitTapHighlightColor: 'transparent',
        } as unknown as ViewStyle)
      : null;

  const inner = loading ? (
    <ActivityIndicator size="small" color={variant === 'ghost' ? C.accent : variant === 'secondary' ? C.text : '#fff'} />
  ) : (
    <>
      {IconComp ? <IconComp size={18} color={textColor} strokeWidth={2.2} /> : null}
      <Text style={textStyle} numberOfLines={1}>
        {label}
      </Text>
    </>
  );

  // delayPressIn は PressableProps の型に乗ってないが Pressable 実装はサポート
  // (OS デフォルト ~130ms 遅延を消して体感応答速度を上げる)
  const extraPressableProps = { delayPressIn: 0 } as Record<string, unknown>;

  return (
    <Animated.View style={[animStyle, fullWidth ? { alignSelf: 'stretch' } : { alignSelf: 'flex-start' }]}>
      <Pressable
        {...extraPressableProps}
        onPress={isDisabled ? undefined : onPress}
        onPressIn={onPressInHandler}
        onPressOut={onPressOutHandler}
        disabled={isDisabled}
        hitSlop={8}
        {...a11yProps}
        style={[containerStyle, webCursorStyle]}
      >
        {gradientColors ? (
          <LinearGradient
            colors={[...gradientColors]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: 0,
              bottom: 0,
            }}
          />
        ) : null}
        {inner}
      </Pressable>
    </Animated.View>
  );
}
