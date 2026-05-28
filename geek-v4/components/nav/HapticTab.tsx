import { Pressable, PressableProps, Platform } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { hap } from '../../design/haptics';
import { SPRING_SNAPPY } from '../../design/motion';

const APressable = Animated.createAnimatedComponent(Pressable);

type Props = Omit<PressableProps, 'onPress'> & {
  focused: boolean;
  onPress: () => void;
  // active tab を再タップしたとき (上スクロール / wiggle feedback の起点)
  onPressAgain?: () => void;
  children: React.ReactNode;
};

// iOS-native bottom tab は press 時に大きく scale しない (HIG 準拠)。
// 「押した感」は haptic + icon 色 + label weight 変化で表現する。
// 0.96 はごく僅かに沈む程度で、物理ボタンのような体感を残す。
const TAB_PRESS_SCALE = 0.96;

// ============================================================
// HapticTab — bottom tab の press feedback + haptic
// ------------------------------------------------------------
// 設計 (2026-05-28 iOS-native refresh):
//   - 別 tab に切替: hap.tap() — light impact (iOS HIG の selection-ish)
//   - 同 tab 再タップ: hap.select() — selection async (subtle click)
//   - press scale は 0.96 (iOS tab bar は scale でなく色/重みで状態を示すのが流儀)
//   - web では cursor: pointer + tap-highlight 抑止
// ============================================================
export function HapticTab({ focused, onPress, onPressAgain, children, ...rest }: Props) {
  const scale = useSharedValue(1);
  const aScale = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  // delayPressIn は AnimatedPressable の型に乗ってないのでキャストして渡す
  const extra = { delayPressIn: 0 } as Record<string, unknown>;

  const webStyle =
    Platform.OS === 'web'
      ? ({
          cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
          userSelect: 'none',
        } as Record<string, unknown>)
      : null;

  return (
    <APressable
      {...rest}
      {...extra}
      onPressIn={() => {
        scale.value = withSpring(TAB_PRESS_SCALE, SPRING_SNAPPY);
        // press-in で即 haptic → 体感反応速度向上
        // - 別 tab: light impact (新しい場所に行く合図)
        // - 同 tab 再タップ: selection (subtle click)
        if (focused) {
          hap.select();
        } else {
          hap.tap();
        }
      }}
      onPressOut={() => {
        scale.value = withSpring(1, SPRING_SNAPPY);
      }}
      onPress={() => {
        if (focused && onPressAgain) {
          // 同 tab 再タップ — 親に通知 (TabBar 側で wiggle + scroll-to-top)
          onPressAgain();
        }
        onPress();
      }}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      // iOS HIG: tab の tappable area は最小 44pt。flex: 1 で水平に伸ばし、
      // 高さは親 (TabBar) が決める bar 高 + label を含めて十分確保される。
      style={[
        { flex: 1, alignItems: 'center', justifyContent: 'center' },
        aScale,
        webStyle as object,
      ]}
    >
      {children}
    </APressable>
  );
}
