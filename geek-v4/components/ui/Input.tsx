import { forwardRef, useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react-native';
import { View, TextInput, Text, type TextInputProps, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  interpolateColor,
} from 'react-native-reanimated';
import { C, SP, R, SIZE } from '@/design/tokens';
import { T } from '@/design/typography';
import { TIMING_FAST } from '@/design/motion';

type Props = TextInputProps & {
  label?: string;
  error?: string;
  containerStyle?: ViewStyle;
  icon?: LucideIcon | ComponentType<{ size: number; color: string; strokeWidth: number }>;
  right?: React.ReactNode;
};

export const Input = forwardRef<TextInput, Props>(function Input(
  { label, error, containerStyle, style, icon: IconComp, right, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const multiline = rest.multiline === true;
  // エラー状態: 視覚的に明確にする (赤枠) — focused より優先
  const showError = Boolean(error);

  // borderColor を Reanimated で滑らかに遷移させる。
  // state は 0 = transparent / 1 = focused (accent) / 2 = error (red)。
  const focusProgress = useSharedValue(0);
  useEffect(() => {
    const target = showError ? 2 : focused ? 1 : 0;
    focusProgress.value = withTiming(target, TIMING_FAST);
  }, [focused, showError, focusProgress]);

  const aBorder = useAnimatedStyle(() => ({
    borderColor: interpolateColor(
      focusProgress.value,
      [0, 1, 2],
      ['rgba(0,0,0,0)', C.accent, C.red],
    ),
  }));

  return (
    <View style={[{ gap: SP['1'] }, containerStyle]}>
      {label && <Text style={[T.small, { color: C.text2 }]}>{label}</Text>}
      <Animated.View
        style={[
          {
            // multiline 時は固定高さを外して minHeight にする — placeholder が
            // ラベルとぶつかったり content が cut off されないように
            ...(multiline
              ? { minHeight: SIZE.input, paddingVertical: SP['2'] }
              : { height: SIZE.input }),
            borderRadius: R.md,
            backgroundColor: C.bg3,
            borderWidth: 1.5,
            flexDirection: 'row',
            alignItems: multiline ? 'flex-start' : 'center',
            paddingHorizontal: SP['4'],
            gap: SP['2'],
          },
          aBorder,
        ]}
      >
        {IconComp && (
          <View style={{ marginTop: multiline ? 10 : 0 }}>
            <IconComp size={18} color={C.text3} strokeWidth={2.2} />
          </View>
        )}
        <TextInput
          ref={ref}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholderTextColor={C.text3}
          style={[T.body, { flex: 1, color: C.text }, style]}
          {...rest}
        />
        {right}
      </Animated.View>
      {error && <Text style={[T.small, { color: C.red }]}>{error}</Text>}
    </View>
  );
});
