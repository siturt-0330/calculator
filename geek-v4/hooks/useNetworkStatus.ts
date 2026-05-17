import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

// 軽量なネットワーク状態フック
// - Web: navigator.onLine + online/offline event
// - Native: NetInfo は別途必要 (Expo Go では @react-native-community/netinfo 必須)
//   今は web 中心なので web 対応のみ実装、ネイティブは常時 online で動かす
export function useNetworkStatus(): { online: boolean } {
  const initial = Platform.OS === 'web'
    ? (typeof navigator !== 'undefined' ? navigator.onLine : true)
    : true;
  const [online, setOnline] = useState(initial);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return { online };
}
