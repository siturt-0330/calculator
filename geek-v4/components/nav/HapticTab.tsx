import { Pressable, PressableProps } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { hap } from '../../design/haptics';
import { SPRING_SNAPPY, FAB_SCALE } from '../../design/motion';
import { TABBAR } from '../../design/tabbar';

const APressable = Animated.createAnimatedComponent(Pressable);

type Props = Omit<PressableProps, 'onPress'> & {
  focused: boolean;
  onPress: () => void;
  // active tab を再タップしたとき (上スクロール / wiggle feedback の起点)
  onPressAgain?: () => void;
  children: React.ReactNode;
};

// ============================================================
// HapticTab — bottom tab の press feedback + 「ぐっと響く」haptic
// ------------------------------------------------------------
// UI fix (2026-05-26): 旧版は active タブの上に「accent 色の小さな dash」を
// absolute 配置していたが、container pill の上端付近にかかって「枠からはみ出てる」
// 印象を与えていた。active TabPill (rgba accent bg + accent border + label)
// 自体で十分に「選択中」が伝わるため、redundant な dash は削除。
//
// Polish (2026-05-28): haptic を「ぐっと響く」感じに refine.
//   - 別 tab に切替: hap.select() — selection (light tap) で軽快に
//   - 同 tab 再タップ: hap.confirm() — medium impact で重みを出し、
//     onPressAgain を呼んで TabBar 側で上スクロール + wiggle トリガに使う
//   - press scale: FAB_SCALE (0.92) で旧 PRESS_SCALE (0.96) より深め
//     → tab という頻用 UI 要素にしては「押した実感」を強める
// ============================================================
export function HapticTab({ focused, onPress, onPressAgain, children, ...rest }: Props) {
  const scale = useSharedValue(1);
  const aScale = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  // delayPressIn は AnimatedPressable の型に乗ってないのでキャストして渡す
  const extra = { delayPressIn: 0 } as Record<string, unknown>;

  return (
    <APressable
      {...rest}
      {...extra}
      onPressIn={() => {
        scale.value = withSpring(FAB_SCALE, SPRING_SNAPPY);
        // press-in で即 haptic → 体感反応速度向上
        // 同 tab 再タップは medium (top scroll feedback)、別 tab は selection (light tap)
        if (focused) {
          hap.confirm();
        } else {
          hap.select();
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
      style={[
        { flex: 1, alignItems: 'center', justifyContent: 'center', height: TABBAR.height },
        aScale,
      ]}
    >
      {children}
    </APressable>
  );
}
