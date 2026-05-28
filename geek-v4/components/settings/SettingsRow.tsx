import { View, Text } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  interpolateColor,
} from 'react-native-reanimated';
import type { LucideIcon } from 'lucide-react-native';

import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';
import { SP, R } from '../../design/tokens';
import { T } from '../../design/typography';
import { SPRING_SNAPPY } from '../../design/motion';
import { useColors } from '../../hooks/useColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';

// ============================================================
// SettingsRow — SectionCard 内で使うリッチな 1 行コンポーネント
// ------------------------------------------------------------
// ListItem を拡張する形 (touching ListItem.tsx は禁止指示なので別 component に).
//
// 構造:
//   [ 32x32 rounded tint container | icon ]  Label              [right slot]
//                                          sublabel (optional)
//
// - icon コンテナは「ほんのり色付き」で、薄いアクセント (per-row tint or accentMuted).
// - destructive な行 (ログアウト, アカウント削除) は icon container を C.redBg, icon=C.red,
//   label=C.red の組合せにする。
// - press 時: 背景を C.bg2 → C.bg3 にうっすら反転、chevron を 4px 右にスライド。
//   ReducedMotion で全部 skip.
// ============================================================

export type SettingsRowProps = {
  icon: LucideIcon;
  label: string;
  sublabel?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  destructive?: boolean;
  /** icon container の tint 色 (背景). 省略時は accentSoft. */
  tintBg?: string;
  /** icon の色. 省略時は accent (destructive なら red, tintFg 指定時はそれ). */
  tintFg?: string;
  /** disabled で press 抑止 + opacity 0.5 */
  disabled?: boolean;
};

export function SettingsRow({
  icon: I,
  label,
  sublabel,
  right,
  onPress,
  destructive,
  tintBg,
  tintFg,
  disabled,
}: SettingsRowProps) {
  const C = useColors();
  const reduceMotion = useReducedMotion();
  const ChevronR = Icon.chevronR;

  const press = useSharedValue(0);

  const rowAnimStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(press.value, [0, 1], [C.bg2, C.bg3]),
  }));

  const chevronAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: press.value * 4 }],
  }));

  // 色解決
  const labelColor = destructive ? C.red : C.text;
  const iconBg = destructive ? C.redBg : (tintBg ?? C.accentSoft);
  const iconFg = destructive ? C.red : (tintFg ?? C.accent);

  const handlePressIn = () => {
    if (disabled || reduceMotion) return;
    press.value = withTiming(1, { duration: 80 });
  };
  const handlePressOut = () => {
    if (disabled) return;
    if (reduceMotion) {
      press.value = 0;
      return;
    }
    press.value = withSpring(0, SPRING_SNAPPY);
  };

  const inner = (
    <Animated.View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: SP['4'],
          paddingVertical: SP['3'] + 2,
          gap: SP['3'],
          opacity: disabled ? 0.5 : 1,
        },
        rowAnimStyle,
      ]}
    >
      {/* icon container — 32x32 rounded square w/ tint background */}
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          backgroundColor: iconBg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <I size={18} color={iconFg} strokeWidth={2.2} />
      </View>

      <View style={{ flex: 1 }}>
        <Text style={[T.body, { color: labelColor, fontWeight: '500' }]} numberOfLines={1}>
          {label}
        </Text>
        {sublabel ? (
          <Text style={[T.caption, { color: C.text3, marginTop: 1 }]} numberOfLines={1}>
            {sublabel}
          </Text>
        ) : null}
      </View>

      {right ??
        (onPress ? (
          <Animated.View style={chevronAnimStyle}>
            <ChevronR size={18} color={C.text3} strokeWidth={2.2} />
          </Animated.View>
        ) : null)}
    </Animated.View>
  );

  if (onPress) {
    return (
      <PressableScale
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled}
        haptic="tap"
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={sublabel}
      >
        {inner}
      </PressableScale>
    );
  }
  return inner;
}

// SettingsRow がそのまま radius を要求されたとき (外側 SectionCard を使わない場面) 用に
// borderRadius を持つラッパが必要なら使ってください。基本は SectionCard 経由で使うこと。
export function StandaloneSettingsRow(props: SettingsRowProps) {
  const C = useColors();
  return (
    <View
      style={{
        marginHorizontal: SP['4'],
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
        overflow: 'hidden',
      }}
    >
      <SettingsRow {...props} />
    </View>
  );
}
