import { View, Text } from 'react-native';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { C, SP } from '@/design/tokens';
import { T } from '@/design/typography';

export function OfflineBanner() {
  const { online } = useNetworkStatus();
  if (online) return null;
  return (
    <View style={{
      paddingHorizontal: SP['3'],
      paddingVertical: SP['1'],
      backgroundColor: '#E24B4A',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: SP['2'],
    }}>
      <Text style={{ fontSize: 14 }}>📡</Text>
      <Text style={[T.smallM, { color: '#fff', fontWeight: '700' }]}>
        オフラインです — キャッシュ表示中。投稿は復活時に同期されます
      </Text>
    </View>
  );
}
