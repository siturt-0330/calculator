import { View, ViewStyle, StyleProp, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { C, R } from '@/design/tokens';

export function BlurCard({
  children,
  style,
  radius = R.lg,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  radius?: number;
}) {
  if (Platform.OS === 'ios') {
    return (
      <BlurView
        intensity={20}
        tint="dark"
        style={[
          {
            borderRadius: radius,
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: C.glassBorder,
          },
          style,
        ]}
      >
        {children}
      </BlurView>
    );
  }
  return (
    <View
      style={[
        {
          borderRadius: radius,
          backgroundColor: C.bg2,
          borderWidth: 1,
          borderColor: C.border,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
