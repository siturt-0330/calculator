import { type ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  Text,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { GRAD, SHADOW, C, R, SP } from '../../design/tokens';

type Variant = 'gradient' | 'glass' | 'solid' | 'outline';
type Size = 'sm' | 'md' | 'lg';
type HapticType = 'tap' | 'confirm' | 'warn' | 'select';
type GradientKey = keyof typeof GRAD;

export interface PolishedButtonProps {
  /** default 'solid' */
  variant?: Variant;
  /** variant='gradient' のとき使う GRAD のキー (default 'primary') */
  gradient?: GradientKey;
  label: string;
  /** 左 icon */
  icon?: ReactNode;
  /** 右 icon */
  rightIcon?: ReactNode;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** default 'tap'. null で完全無効 */
  haptic?: HapticType | null;
  fullWidth?: boolean;
  /** default 'md' */
  size?: Size;
  style?: StyleProp<ViewStyle>;
  /** variant='gradient' のとき GRAD.destructive (赤グラデ) に強制切替 */
  destructive?: boolean;
}

// size 別の padding / 高さ / font-size
const SIZE_STYLES: Record<Size, { padding: number; minHeight: number; fontSize: number }> = {
  sm: { padding: SP['2'], minHeight: 36, fontSize: 13 },
  md: { padding: SP['3'], minHeight: 44, fontSize: 15 },
  lg: { padding: SP['4'], minHeight: 52, fontSize: 17 },
};

function triggerHaptic(type: HapticType) {
  if (Platform.OS === 'web') return;
  try {
    switch (type) {
      case 'tap':
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        break;
      case 'confirm':
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        break;
      case 'warn':
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        break;
      case 'select':
        Haptics.selectionAsync();
        break;
    }
  } catch {
    // haptic は best-effort. 例外は握りつぶす (CLAUDE.md の swallow ポリシーに準拠)
  }
}

/**
 * PolishedButton — 既存 Button.tsx の upgrade 版 (共存させる)。
 *
 * - variant='gradient': LinearGradient を背景に敷き、SHADOW.glow + 白文字
 * - variant='glass':    rgba 半透明背景 + 白文字 (BlurView は使わない. View only)
 * - variant='solid':    C.accent 単色背景 + 白文字
 * - variant='outline':  透明背景 + 1.5px C.accent border + C.accent text
 * - haptic は press-in で発火 (体感応答速度のため. PressableScale 流儀)
 * - disabled: opacity 0.5, pointerEvents none
 * - loading: spinner を icon の代わりに描画
 * - destructive=true (gradient のみ): GRAD.destructive (赤) に強制切替
 *
 * 既存 Button.tsx は変更せず並列で生きる。新規画面は PolishedButton を使う想定。
 */
export function PolishedButton({
  variant = 'solid',
  gradient = 'primary',
  label,
  icon,
  rightIcon,
  onPress,
  disabled = false,
  loading = false,
  haptic = 'tap',
  fullWidth = false,
  size = 'md',
  style,
  destructive = false,
}: PolishedButtonProps) {
  const sizeStyle = SIZE_STYLES[size];
  const isDisabled = disabled || loading;

  // destructive で gradient なら destructive グラデに. それ以外は指定通り。
  const gradientKey: GradientKey =
    variant === 'gradient' && destructive ? 'destructive' : gradient;
  const gradientColors = GRAD[gradientKey];

  // text / icon の色
  const textColor =
    variant === 'outline' ? C.accent : '#fff';

  // 共通 container style
  const baseContainer: ViewStyle = {
    minHeight: sizeStyle.minHeight,
    paddingVertical: sizeStyle.padding,
    paddingHorizontal: sizeStyle.padding * 1.5,
    borderRadius: R.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP['2'],
    overflow: 'hidden',
    opacity: isDisabled ? 0.5 : 1,
    ...(fullWidth ? { alignSelf: 'stretch' } : { alignSelf: 'flex-start' }),
  };

  // variant ごとの背景 / border 設定
  let variantStyle: ViewStyle = {};
  if (variant === 'solid') {
    variantStyle = { backgroundColor: C.accent };
  } else if (variant === 'glass') {
    variantStyle = {
      backgroundColor: C.glass,
      borderWidth: 1,
      borderColor: C.glassBorder,
    };
  } else if (variant === 'outline') {
    variantStyle = {
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      borderColor: C.accent,
    };
  }
  // gradient variant は背景を <LinearGradient> overlay で描く

  // gradient variant の glow shadow (disabled 時は外す)
  const glowShadow =
    variant === 'gradient' && !isDisabled ? SHADOW.glow : null;

  const textStyle: TextStyle = {
    color: textColor,
    fontSize: sizeStyle.fontSize,
    fontWeight: '600',
    letterSpacing: 0.2,
  };

  function handlePressIn() {
    if (isDisabled) return;
    if (haptic) triggerHaptic(haptic);
  }

  // Web のみ cursor: pointer (PressableScale と揃える方針)
  // RN の ViewStyle 型には cursor / transition が無いが react-native-web は
  // pass-through する。型エラー回避のため Record<string, unknown> 経由で扱い、
  // style 配列に流し込む際に ViewStyle として読ませる。
  const webCursorStyle: ViewStyle | null =
    Platform.OS === 'web' && !isDisabled
      ? ({
          cursor: 'pointer',
          transition: 'opacity 120ms ease',
        } as unknown as ViewStyle)
      : null;

  const a11y = {
    accessibilityRole: 'button' as const,
    accessibilityLabel: label,
    accessibilityState: { disabled: isDisabled, busy: loading },
  };

  // 内部 content (icon + label or spinner + label)
  const content = (
    <>
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'outline' ? C.accent : '#fff'}
        />
      ) : (
        icon
      )}
      <Text style={textStyle} numberOfLines={1}>
        {label}
      </Text>
      {!loading && rightIcon ? rightIcon : null}
    </>
  );

  if (variant === 'gradient') {
    return (
      <Pressable
        onPress={isDisabled ? undefined : onPress}
        onPressIn={handlePressIn}
        disabled={isDisabled}
        hitSlop={8}
        {...a11y}
        style={[baseContainer, glowShadow, webCursorStyle, style]}
      >
        <LinearGradient
          colors={gradientColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
          }}
        />
        {content}
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={isDisabled ? undefined : onPress}
      onPressIn={handlePressIn}
      disabled={isDisabled}
      hitSlop={8}
      {...a11y}
      style={[baseContainer, variantStyle, webCursorStyle, style]}
    >
      {content}
    </Pressable>
  );
}

export type { Variant as PolishedButtonVariant };
