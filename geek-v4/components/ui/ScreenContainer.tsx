import { View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from '@/design/tokens';

export function ScreenContainer({
  children,
  topPad = false,
  bottomPad = false,
  style,
}: {
  children: React.ReactNode;
  topPad?: boolean;
  bottomPad?: boolean;
  style?: ViewStyle;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        {
          flex: 1,
          backgroundColor: C.bg,
          paddingTop: topPad ? insets.top : 0,
          paddingBottom: bottomPad ? insets.bottom : 0,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
