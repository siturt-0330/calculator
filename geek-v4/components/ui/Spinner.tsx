import { ActivityIndicator, View } from 'react-native';
import { C } from '@/design/tokens';

export function Spinner({ size = 'small', full }: { size?: 'small' | 'large'; full?: boolean }) {
  if (full) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size={size} color={C.accent} />
      </View>
    );
  }
  return <ActivityIndicator size={size} color={C.accent} />;
}
