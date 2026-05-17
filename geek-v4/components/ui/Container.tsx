import { View, useWindowDimensions, type ViewProps, type ViewStyle } from 'react-native';

type Variant = 'narrow' | 'normal' | 'wide';

const MAX: Record<Variant, number> = {
  narrow: 480,
  normal: 720,
  wide: 960,
};

/**
 * Web 上では中央寄せ + 最大幅制限で読みやすく。モバイル幅はフル幅。
 */
export function Container({
  children,
  variant = 'normal',
  style,
  ...rest
}: ViewProps & { variant?: Variant; style?: ViewStyle }) {
  const { width } = useWindowDimensions();
  const max = MAX[variant];
  const apply = width > max;
  return (
    <View
      {...rest}
      style={[
        { width: '100%' },
        apply && { maxWidth: max, alignSelf: 'center' },
        style,
      ]}
    >
      {children}
    </View>
  );
}
