import { View, Text } from 'react-native';
import { C } from '../../design/tokens';

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
      {/* fontSize 11 = Apple HIG 最小。lineHeight 13 = 高さ16 − 枠線1.5×2 の内寸ちょうど */}
      <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800', lineHeight: 13 }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}
