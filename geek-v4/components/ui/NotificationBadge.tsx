import { View, Text } from 'react-native';
import { C } from '@/design/tokens';

export function NotificationBadge({ count, top = -2, right = -2 }: { count: number; top?: number; right?: number }) {
  if (count <= 0) return null;
  const label = count > 99 ? '99+' : String(count);
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top,
        right,
        minWidth: 16,
        height: 16,
        borderRadius: 8,
        paddingHorizontal: 4,
        backgroundColor: C.red,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1.5,
        borderColor: C.bg,
      }}
    >
      <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800', lineHeight: 11 }}>
        {label}
      </Text>
    </View>
  );
}
