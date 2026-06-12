// ============================================================
// useReducedMotion — アプリ設定 OR OS 設定で reduce motion 判定
// ============================================================
// 2026-06-12 改修:
//   旧版は `useSettingsStore((s) => s.reduceMotion)` のみで OS 設定を無視していた。
//   Apple HIG / WCAG: OS の Reduce Motion 設定 (Settings → Accessibility → Motion → Reduce Motion)
//   は常時購読し、アプリ内トグルと OR 評価するのが正解。
//
//   reanimated の useReducedMotion() は:
//     - iOS: UIAccessibility.isReduceMotionEnabled
//     - Android: Settings.Global.TRANSITION_ANIMATION_SCALE / WINDOW_ANIMATION_SCALE
//     - Web: matchMedia('(prefers-reduced-motion: reduce)')
//   を購読し、それぞれの platform で正しい OS 設定を読む。
//
//   既存 import 38 ファイルは変更不要 (シグネチャ互換)。
// ============================================================
import { useReducedMotion as useRNReducedMotion } from 'react-native-reanimated';
import { useSettingsStore } from '../stores/settingsStore';

export function useReducedMotion(): boolean {
  const appSetting = useSettingsStore((s) => s.reduceMotion);
  const osSetting = useRNReducedMotion();
  return appSetting || osSetting;
}
