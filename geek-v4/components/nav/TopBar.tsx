import { View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  interpolate,
  useAnimatedStyle,
  SharedValue,
} from 'react-native-reanimated';
import { C, SP, SIZE } from '../../design/tokens';
import { T } from '../../design/typography';

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
  // large モードのときは、スクロール時に上部タイトルがフェードイン
  // それまでは上部タイトルは非表示
  const aTitle = useAnimatedStyle(() => {
    if (!large) return { opacity: 1 };
    if (!scrollY) return { opacity: 0 };
    return {
      opacity: interpolate(scrollY.value, [0, 60], [0, 1], 'clamp'),
    };
  });

  return (
    <View
      style={[
        {
          paddingTop: insets.top,
          backgroundColor: C.bg,
          borderBottomWidth: border ? 1 : 0,
          borderBottomColor: C.border,
        },
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
    </View>
  );
}
