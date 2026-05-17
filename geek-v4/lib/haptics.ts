import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

export function impact(style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) {
  if (Platform.OS === 'web') return;
  Haptics.impactAsync(style).catch(() => {});
}

export function notify(type: Haptics.NotificationFeedbackType) {
  if (Platform.OS === 'web') return;
  Haptics.notificationAsync(type).catch(() => {});
}

export function select() {
  if (Platform.OS === 'web') return;
  Haptics.selectionAsync().catch(() => {});
}

export { Haptics };
