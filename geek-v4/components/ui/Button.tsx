import { Text, ActivityIndicator, type ViewStyle } from 'react-native';
import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { PressableScale } from './PressableScale';
import { C, SP, R, SHADOW } from '../../design/tokens';
import { T } from '../../design/typography';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

type Props = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  fullWidth?: boolean;
  haptic?: 'tap' | 'select' | 'pop' | 'confirm' | 'success' | 'warn' | 'error';
  icon?: LucideIcon | ComponentType<{ size: number; color: string; strokeWidth: number }>;
};

const HEIGHT: Record<Size, number> = { sm: 36, md: 48, lg: 56 };
const PX: Record<Size, number> = { sm: SP['4'], md: SP['5'], lg: SP['6'] };

function textStyleForSize(size: Size) {
  if (size === 'sm') return T.buttonSm;
  if (size === 'lg') return T.buttonLg;
  return T.buttonMd;
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
  const textStyle = textStyleForSize(size);
  const isDisabled = disabled || loading;
  const opacity = isDisabled ? 0.5 : 1;

  const textColor =
    variant === 'primary'
      ? '#fff'
      : variant === 'danger'
        ? C.red
        : C.accent;

  const inner = loading ? (
    <ActivityIndicator size="small" color={variant === 'primary' ? '#fff' : C.accent} />
  ) : (
    <Text style={[textStyle, { color: textColor }]}>{label}</Text>
  );

  // Primary CTA gets a soft accent halo so it reads as the "do this" affordance.
  // Disabled / loading state drops the glow so we don't draw attention to a
  // dead button.
  const primaryGlow = variant === 'primary' && !isDisabled ? SHADOW.accentGlow : null;

  const containerStyle: ViewStyle = {
    height,
    paddingHorizontal: px,
    borderRadius: R.lg,
    // primary variant の LinearGradient が border radius に追従するように clip
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: SP['2'],
    opacity,
    ...(fullWidth ? { alignSelf: 'stretch' } : { alignSelf: 'flex-start' }),
    ...(variant === 'secondary' ? { backgroundColor: C.bg3 } : {}),
    ...(variant === 'ghost' ? { backgroundColor: 'transparent' } : {}),
    ...(variant === 'danger' ? { backgroundColor: C.bg3 } : {}),
    ...(primaryGlow ?? {}),
    ...(style ?? {}),
  };

  const hapticType = haptic ?? (variant === 'primary' ? 'confirm' : 'tap');

  // a11y: label をそのまま screen reader に渡す + loading 中は busy 状態を伝える。
  // PressableScale の default で role=button / disabled state は付くが、label と busy は
  // Button 側で明示するのが正確。
  const a11yProps = {
    accessibilityLabel: label,
    accessibilityState: { disabled: !!isDisabled, busy: !!loading },
  } as const;

  if (variant === 'primary') {
    return (
      <PressableScale onPress={onPress} disabled={isDisabled} haptic={hapticType} style={containerStyle} {...a11yProps}>
        <LinearGradient
          colors={[...([C.accent, C.accentDeep] as const)]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{
            ...containerStyle,
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
          }}
        />
        {IconComp && <IconComp size={18} color="#fff" strokeWidth={2.2} />}
        {inner}
      </PressableScale>
    );
  }

  return (
    <PressableScale onPress={onPress} disabled={isDisabled} haptic={hapticType} style={containerStyle} {...a11yProps}>
      {IconComp && <IconComp size={18} color={textColor} strokeWidth={2.2} />}
      {inner}
    </PressableScale>
  );
}
