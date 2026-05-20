import { View, ViewStyle } from 'react-native';
import { C } from '../../design/tokens';

export function Divider({ style }: { style?: ViewStyle }) {
  return (
    <View
      style={[{ height: 1, backgroundColor: C.divider }, style]}
    />
  );
}
