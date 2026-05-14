import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useToastStore } from '@/stores/toastStore';
import { ToastItem } from './Toast';
import { SP } from '@/design/tokens';

export function ToastHost() {
  const { toasts, dismiss } = useToastStore();
  const insets = useSafeAreaInsets();

  if (toasts.length === 0) return null;

  return (
    <View
      style={{
        position: 'absolute',
        top: insets.top + SP['2'],
        left: SP['4'],
        right: SP['4'],
        zIndex: 9999,
      }}
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </View>
  );
}
