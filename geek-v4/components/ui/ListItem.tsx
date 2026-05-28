import { View, Text } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  interpolateColor,
} from 'react-native-reanimated';
import type { LucideIcon } from 'lucide-react-native';

import { PressableScale } from './PressableScale';
import { SectionHeader as SharedSectionHeader } from './SectionHeader';
import { Icon } from '../../constants/icons';
import { SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { SPRING_SNAPPY } from '../../design/motion';
import { useColors } from '../../hooks/useColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';

// ============================================================
// ListItem
// ------------------------------------------------------------
// 設定 / 一覧画面で使う 1 行コンポーネント。
//
//   左: icon (24x24, optional)         — important で C.accent, それ以外は C.text2
//   中: label (T.body) + sublabel/subtitle (T.small, C.text2)
//   右: `right` slot (chevron / pill / Switch など) — onPress があり right 未指定なら ChevronRight
//
// Press feedback:
//   - PressableScale で scale 0.96 spring
//   - 行背景を C.bg → C.bg2 へ 80ms ease-out クロスフェード
//   - 右の chevron を translateX 0 → 4 へ spring (SPRING_SNAPPY)
//   - いずれも ReduceMotion 時はスキップ (静止状態の見た目を維持)
//
// API は既存呼び出し側 (settings/index, settings/about) を壊さないように保つ:
//   - label (必須), sublabel, icon, right, onPress, destructive はそのまま
//   - 追加: subtitle (sublabel の alias), important, disabled, onLongPress, border
// ============================================================

export function ListItem({
  label,
  sublabel,
  subtitle,
  icon: I,
  right,
  onPress,
  onLongPress,
  destructive,
  important,
  disabled,
  border,
}: {
  label: string;
  /** 二行目の補足テキスト。`subtitle` でも同じ意味で受け付ける。 */
  sublabel?: string;
  /** `sublabel` のエイリアス (どちらが指定されてもよい)。 */
  subtitle?: string;
  icon?: LucideIcon;
  right?: React.ReactNode;
  onPress?: () => void;
  /** 長押し時のコールバック。PressableScale 側で confirm haptic が発火する。 */
  onLongPress?: () => void;
  destructive?: boolean;
  /** 重要アクション (icon を accent 色に切替えて視線を誘導)。 */
  important?: boolean;
  /** true の時は press アニメ / haptic が発火しない (PressableScale 側で抑止)。 */
  disabled?: boolean;
  /** true の時に 1px の下線 (C.divider) を引く。 */
  border?: boolean;
}) {
  const C = useColors();
  const reduceMotion = useReducedMotion();
  const ChevronR = Icon.chevronR;

  // 0 → 1 で press 状態を表すスカラー。背景色と chevron translateX を両方ここから派生。
  // ReduceMotion 時は press でも 0 に張り付けて静止状態にする。
  const press = useSharedValue(0);

  // 行背景: C.bg ↔ C.bg2 (テーマ切替を即時反映するため useColors の値を毎 render で読む)
  const rowAnimStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(press.value, [0, 1], [C.bg, C.bg2]),
  }));

  // chevron translateX: 0 → 4 (右へ少しスライド)。
  // ReduceMotion 時は常に 0 を返して動かさない。
  const chevronAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: press.value * 4 }],
  }));

  // 色のフォールバック: destructive > important > 通常
  const labelColor = destructive ? C.red : C.text;
  const iconColor = destructive ? C.red : important ? C.accent : C.text2;
  const subColor = C.text2;

  // sublabel と subtitle のどちらが渡されても拾う (subtitle を優先)
  const secondLine = subtitle ?? sublabel;

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
    // 戻りは spring で「ピタッ」と戻す。背景色は interpolateColor を spring で
    // 走らせても自然な見た目になる (rgba 補間 → 視覚的には 80-120ms で完了)。
    press.value = withSpring(0, SPRING_SNAPPY);
  };

  const inner = (
    <Animated.View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: SP['4'],
          paddingVertical: SP['3'],
          gap: SP['3'],
          // border は AnimatedView の bottom に直接付ける (Divider と同じ色)
          borderBottomWidth: border ? 1 : 0,
          borderBottomColor: C.divider,
          // disabled の時は全体を 0.5 で淡くする (押せないという視覚的合図)
          opacity: disabled ? 0.5 : 1,
        },
        rowAnimStyle,
      ]}
    >
      {I && (
        <View style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
          <I size={20} color={iconColor} strokeWidth={2.2} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={[T.body, { color: labelColor }]} numberOfLines={1}>
          {label}
        </Text>
        {secondLine ? (
          <Text style={[T.small, { color: subColor, marginTop: 2 }]} numberOfLines={2}>
            {secondLine}
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

  if (onPress || onLongPress) {
    return (
      <PressableScale
        onPress={onPress}
        onLongPress={onLongPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled}
        haptic="tap"
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={secondLine}
      >
        {inner}
      </PressableScale>
    );
  }
  return inner;
}

// ============================================================
// ListItem.SectionHeader — 隣接 import を増やさず使えるよう、
// 共有 SectionHeader を本 module からも export しておく。
// ============================================================
export const ListSectionHeader = SharedSectionHeader;
