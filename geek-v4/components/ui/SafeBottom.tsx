import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function SafeBottom({ extra = 0 }: { extra?: number }) {
  const insets = useSafeAreaInsets();
  return <View style={{ height: insets.bottom + extra }} />;
}
