import { Platform, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  SharedValue,
} from 'react-native-reanimated';
import { SP, SIZE } from '../../design/tokens';
import { T } from '../../design/typography';
import { useColors } from '../../hooks/useColors';

type Props = {
  title?: string;
  large?: boolean;
  scrollY?: SharedValue<number>;
  left?: React.ReactNode;
  right?: React.ReactNode;
  style?: ViewStyle;
  border?: boolean;
};

export function TopBar({
  title,
  large,
  scrollY,
  left,
  right,
  style,
  border = true,
}: Props) {
  const insets = useSafeAreaInsets();
  const C = useColors();
  const reduceMotion = useReducedMotion();
  // large モードのときは、スクロール時に上部タイトルがフェードイン
  // それまでは上部タイトルは非表示
  const aTitle = useAnimatedStyle(() => {
    if (!large) return { opacity: 1 };
    if (!scrollY) return { opacity: 0 };
    return {
      opacity: interpolate(scrollY.value, [0, 60], [0, 1], 'clamp'),
    };
  });

  // scrollY に応じて背景の透明度と border が「徐々に現れる」
  // iOS Safari の URL bar 風: 0px → 透明 / 60px → 完全 opaque
  // border は 30px から fade in
  // scrollY が undefined のとき / reduceMotion のときは static (常時 opaque)
  const aContainer = useAnimatedStyle(() => {
    if (!scrollY || reduceMotion) {
      return {
        backgroundColor: C.bg,
        borderBottomWidth: border ? 1 : 0,
        borderBottomColor: C.border,
        ...(Platform.OS === 'web' && border
          ? ({ backdropFilter: 'blur(12px)' } as object)
          : null),
      };
    }
    const bg = interpolateColor(
      scrollY.value,
      [0, 60],
      ['transparent', C.bg],
    );
    const bw = border
      ? interpolate(scrollY.value, [30, 60], [0, 1], 'clamp')
      : 0;
    const blurPx = interpolate(scrollY.value, [0, 60], [0, 12], 'clamp');
    return {
      backgroundColor: bg,
      borderBottomWidth: bw,
      borderBottomColor: C.border,
      // border 自体のフェードは width 0→1px で代用 (色側で吸収すると
      // borderBottomColor を rgba 化する必要があり、トークンを崩すため避ける)
      ...(Platform.OS === 'web'
        ? ({ backdropFilter: `blur(${blurPx}px)` } as object)
        : null),
    };
  });

  return (
    <Animated.View
      style={[
        {
          paddingTop: insets.top,
        },
        aContainer,
        style,
      ]}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: SP['4'],
          height: SIZE.topBar,
          gap: SP['2'],
        }}
      >
        {left}
        <Animated.Text
          numberOfLines={1}
          style={[T.h3, { color: C.text, flex: 1 }, aTitle]}
        >
          {large ? '' : (title ?? '')}
        </Animated.Text>
        {right}
      </View>
      {large && title && (
        <View style={{ paddingHorizontal: SP['4'], paddingBottom: SP['3'] }}>
          <Animated.Text style={[T.display, { color: C.text }]}>{title}</Animated.Text>
        </View>
      )}
    </Animated.View>
  );
}
