import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

// ============================================================
// Haptic presets
// ============================================================
//
// PressableScale 等から `haptic('tap')` のように呼べる semantic な
// プリセット。Web では全 no-op (Haptics API は無いため)。
// 内部で発生する Promise の rejection は握り潰す (ユーザー体験には
// 影響しないし、デバイスによっては失敗するため)。
//
//  tap      — 軽いタップ feedback (default)
//  select   — 値の切替 (segmented control 等)
//  pop      — やや強めの "ポップ" (FAB / 主要 CTA)
//  confirm  — 確定の合図 (pop と同等、意味別エイリアス)
//  success  — 完了通知
//  warn     — 警告
//  error    — エラー
//
export type HapticKind = 'tap' | 'select' | 'pop' | 'confirm' | 'success' | 'warn' | 'error';

const enabled = Platform.OS === 'ios' || Platform.OS === 'android';

export function haptic(kind: HapticKind): void {
  if (!enabled) return;
  try {
    switch (kind) {
      case 'tap':
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        break;
      case 'select':
        Haptics.selectionAsync().catch(() => {});
        break;
      case 'pop':
      case 'confirm':
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        break;
      case 'success':
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        break;
      case 'warn':
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        break;
      case 'error':
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        break;
    }
  } catch {
    /* silently swallow — haptic は best-effort */
  }
}

// ============================================================
// Legacy primitives (既存 caller のため維持)
// ============================================================
export function impact(style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) {
  if (!enabled) return;
  Haptics.impactAsync(style).catch(() => {});
}

export function notify(type: Haptics.NotificationFeedbackType) {
  if (!enabled) return;
  Haptics.notificationAsync(type).catch(() => {});
}

export function select() {
  if (!enabled) return;
  Haptics.selectionAsync().catch(() => {});
}

export { Haptics };

// ============================================================
// hapticPresets — iOS-native 風の object-shape API
// ============================================================
//
// `haptic(kind)` 関数版とは別に "named method" 形式で叩ける object。
// Button / ActionSheet / Toggle など、変種に応じて意味別に
// `hapticPresets.success()` のようにドット呼び出ししたい呼び出し側のため。
// web では全 method が no-op (内部の impact/notify が enabled flag で gate)。
// すべての Promise は内部で握り潰されるため await 不要。
//
export const hapticPresets = {
  light: (): void => {
    if (!enabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  },
  medium: (): void => {
    if (!enabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  },
  heavy: (): void => {
    if (!enabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
  },
  success: (): void => {
    if (!enabled) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  },
  warning: (): void => {
    if (!enabled) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  },
  error: (): void => {
    if (!enabled) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
  },
} as const;

export type HapticPresetKey = keyof typeof hapticPresets;
