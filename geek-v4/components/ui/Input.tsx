import { forwardRef, useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react-native';
import { Platform, View, TextInput, Text, type TextInputProps, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  interpolateColor,
} from 'react-native-reanimated';
import { C, SP, R, SIZE } from '../../design/tokens';
import { T } from '../../design/typography';
import { TIMING_FAST } from '../../design/motion';

type Props = TextInputProps & {
  label?: string;
  error?: string;
  containerStyle?: ViewStyle;
  icon?: LucideIcon | ComponentType<{ size: number; color: string; strokeWidth: number }>;
  right?: React.ReactNode;
};

// 防御的 default — 個別の TextInput に maxLength を付け忘れても、
// 攻撃者が 10MB の文字列を貼り付けて state 更新で UI freeze + memory 枯渇を
// 起こすのを防ぐ safety net。caller が明示的に maxLength を指定したらそちらを尊重する。
// 200 文字あれば search query / 一般的な単行入力には十分。長文 (本文・コメント等)
// は TextArea を使うか、各 caller で明示的に大きい maxLength を渡すこと。
const DEFAULT_INPUT_MAX_LENGTH = 200;

export const Input = forwardRef<TextInput, Props>(function Input(
  { label, error, containerStyle, style, icon: IconComp, right, maxLength, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const multiline = rest.multiline === true;
  const effectiveMaxLength = maxLength ?? DEFAULT_INPUT_MAX_LENGTH;
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
          // Web: focus 時に CSS box-shadow で柔らかい halo を出す。
          // RN-Native は Animated.View に shadow を当てると静的計算しか効かないので web 限定。
          Platform.OS === 'web' && focused && !showError
            ? // RN-web は box-shadow を直接通す
              ({ boxShadow: '0 0 0 4px rgba(124,106,247,0.18)' } as object)
            : null,
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
          // dark theme で黒系カーソルが見えなくなる事故防止
          // - selectionColor: 選択範囲ハイライト (iOS/Android/Web)
          // - cursorColor: Android 13+ のキャレット色 (selectionColor だけだと薄い)
          selectionColor={C.accent}
          cursorColor={C.accent}
          {...rest}
          // maxLength は rest を展開した *後* に置く — caller が明示的に渡した
          // value を使い、未指定なら defense-in-depth で 200 文字 cap
          maxLength={effectiveMaxLength}
          style={[T.body, { flex: 1, color: C.text }, style]}
        />
        {right}
      </Animated.View>
      {error && <Text style={[T.small, { color: C.red }]}>{error}</Text>}
    </View>
  );
});
