import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

const isHapticAvailable = Platform.OS === 'ios' || Platform.OS === 'android';

async function safe(fn: () => Promise<void>) {
  if (!isHapticAvailable) return;
  try { await fn(); } catch { /* ignore */ }
}

export const hap = {
  tap: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  confirm: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  pop: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)),
  select: () => safe(() => Haptics.selectionAsync()),
  success: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warn: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
} as const;

export type HapticKind = keyof typeof hap;
