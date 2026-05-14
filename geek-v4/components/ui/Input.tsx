import { useState } from 'react';
import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react-native';
import { View, TextInput, Text, type TextInputProps, type ViewStyle } from 'react-native';
import { C, SP, R, SIZE } from '@/design/tokens';
import { T } from '@/design/typography';

type Props = TextInputProps & {
  label?: string;
  error?: string;
  containerStyle?: ViewStyle;
  icon?: LucideIcon | ComponentType<{ size: number; color: string; strokeWidth: number }>;
  right?: React.ReactNode;
};

export function Input({ label, error, containerStyle, style, icon: IconComp, right, ...rest }: Props) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={[{ gap: SP['1'] }, containerStyle]}>
      {label && <Text style={[T.small, { color: C.text2 }]}>{label}</Text>}
      <View
        style={{
          height: SIZE.input,
          borderRadius: R.md,
          backgroundColor: C.bg3,
          borderWidth: 1.5,
          borderColor: focused ? C.accent : 'transparent',
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: SP['4'],
          gap: SP['2'],
        }}
      >
        {IconComp && <IconComp size={18} color={C.text3} strokeWidth={2.2} />}
        <TextInput
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholderTextColor={C.text3}
          style={[T.body, { flex: 1, color: C.text }, style]}
          {...rest}
        />
        {right}
      </View>
      {error && <Text style={[T.small, { color: C.red }]}>{error}</Text>}
    </View>
  );
}
