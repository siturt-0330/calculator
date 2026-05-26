import { Pressable, PressableProps } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { hap } from '../../design/haptics';
import { SPRING_SNAP, PRESS_SCALE } from '../../design/motion';
import { TABBAR } from '../../design/tabbar';

const APressable = Animated.createAnimatedComponent(Pressable);

type Props = Omit<PressableProps, 'onPress'> & {
  focused: boolean;
  onPress: () => void;
  children: React.ReactNode;
};

// UI fix (2026-05-26): 旧版は active タブの上に「accent 色の小さな dash
// (top:6, width:28, height:3)」を absolute 配置していたが、container pill
// (borderRadius:32, paddingVertical:6) の上端付近にかかって「枠からはみ出てる」
// 印象を与えていた。active TabPill (rgba accent bg + accent border + label)
// 自体で十分に「選択中」が伝わるため、redundant な dash は削除。
export function HapticTab({ focused, onPress, children, ...rest }: Props) {
  const scale = useSharedValue(1);
  const aScale = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  // delayPressIn は AnimatedPressable の型に乗ってないのでキャストして渡す
  const extra = { delayPressIn: 0 } as Record<string, unknown>;

  return (
    <APressable
      {...rest}
      {...extra}
      onPressIn={() => {
        scale.value = withSpring(PRESS_SCALE, SPRING_SNAP);
        // press-in で即 haptic → 体感反応速度向上
        hap.tap();
      }}
      onPressOut={() => {
        scale.value = withSpring(1, SPRING_SNAP);
      }}
      onPress={onPress}
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
