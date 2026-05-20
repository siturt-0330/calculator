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

export function TextArea({ label, error, containerStyle, style, minHeight = 120, ...rest }: Props) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={[{ gap: SP['1'] }, containerStyle]}>
      {label && <Text style={[T.small, { color: C.text2 }]}>{label}</Text>}
      <TextInput
        multiline
        textAlignVertical="top"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholderTextColor={C.text3}
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
        {...rest}
      />
      {error && <Text style={[T.small, { color: C.red }]}>{error}</Text>}
    </View>
  );
}
