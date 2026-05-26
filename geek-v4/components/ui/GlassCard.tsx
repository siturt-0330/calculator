import { Platform, View, type ViewProps, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { C, R, SP } from '../../design/tokens';

type Tint = 'light' | 'dark' | 'default';

export interface GlassCardProps extends ViewProps {
  /** BlurView intensity (1-100, default 30) */
  intensity?: number;
  /** Blur tint (default 'dark' — Geek は dark theme) */
  tint?: Tint;
  /** padding 既定 SP['4']. 0 にしたい場合は style で上書き */
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

/**
 * 半透明 + (Native のみ) backdrop blur のカード。
 *
 * - Native (iOS/Android): expo-blur の <BlurView> を使い実際にぼかす
 * - Web: BlurView は web ではノーオペに近く、かつ react-native-web は
 *   `backdropFilter` を style として通さない (CSS としては存在するが RN style
 *   からは inline 化されない)。よって rgba 背景 + 1px white border + R.lg で
 *   "glass" の見た目を擬似的に作る。CSS の backdrop-filter を活かしたい
 *   呼び出し側は style に { backdropFilter: 'blur(20px)' } as any を足す手も
 *   あるが、any 禁止の lint を踏むのでここでは入れない。
 * - borderColor: 'rgba(255,255,255,0.1)' で 1px の細い縁取り
 * - borderRadius: R.lg
 */
export function GlassCard({
  intensity = 30,
  tint = 'dark',
  style,
  children,
  ...rest
}: GlassCardProps) {
  const baseStyle: ViewStyle = {
    borderRadius: R.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: SP['4'],
  };

  if (Platform.OS === 'web') {
    // Web: 半透明背景で代替。実 blur は無いが、暗背景に重ねるのでガラス感は十分。
    return (
      <View
        style={[
          baseStyle,
          {
            backgroundColor:
              tint === 'light'
                ? 'rgba(255,255,255,0.08)'
                : tint === 'dark'
                  ? 'rgba(0,0,0,0.45)'
                  : C.glass,
          },
          style,
        ]}
        {...rest}
      >
        {children}
      </View>
    );
  }

  // Native (iOS/Android)
  return (
    <BlurView intensity={intensity} tint={tint} style={[baseStyle, style]} {...rest}>
      {children}
    </BlurView>
  );
}
