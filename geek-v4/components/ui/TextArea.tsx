import { useState } from 'react';
import { View, TextInput, Text, type TextInputProps, type ViewStyle } from 'react-native';
import { C, SP, R } from '../../design/tokens';
import { T } from '../../design/typography';

type Props = TextInputProps & {
  label?: string;
  error?: string;
  containerStyle?: ViewStyle;
  minHeight?: number;
};

// 防御的 default — 個別の caller が maxLength を指定し忘れても、
// 攻撃者が巨大文字列を貼り付けて state 更新で UI freeze + memory 枯渇を
// 起こすのを防ぐ safety net。caller が明示的に渡したら尊重する。
// 2000 文字 = 投稿本文と同じ上限 (post/create.tsx の content 上限と一致)。
const DEFAULT_TEXTAREA_MAX_LENGTH = 2000;

export function TextArea({ label, error, containerStyle, style, minHeight = 120, maxLength, ...rest }: Props) {
  const [focused, setFocused] = useState(false);
  const effectiveMaxLength = maxLength ?? DEFAULT_TEXTAREA_MAX_LENGTH;

  return (
    <View style={[{ gap: SP['1'] }, containerStyle]}>
      {label && <Text style={[T.small, { color: C.text2 }]}>{label}</Text>}
      <TextInput
        multiline
        textAlignVertical="top"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholderTextColor={C.text3}
        {...rest}
        // maxLength は rest を展開した *後* に置く — caller が明示的に渡した
        // value を使い、未指定なら defense-in-depth で 2000 文字 cap
        maxLength={effectiveMaxLength}
        style={[
          T.body,
          {
            minHeight,
            padding: SP['4'],
            borderRadius: R.md,
            backgroundColor: C.bg3,
            color: C.text,
            borderWidth: 1.5,
            borderColor: focused ? C.accent : 'transparent',
          },
          style,
        ]}
      />
      {error && <Text style={[T.small, { color: C.red }]}>{error}</Text>}
    </View>
  );
}
