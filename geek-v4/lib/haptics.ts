import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

// ============================================================
// Haptic presets — Single Source of Truth
// ============================================================
//
// haptic API はこのファイルに統一する (2026-06 監査で 3 系統並立を解消)。
//   - design/haptics.ts  … ここからの re-export (hap 名前空間の互換維持)
//   - hooks/useHaptic.ts … ここを参照する thin wrapper
// 強度マッピングを変えるときは必ずこのファイルだけを編集する。
//
// PressableScale 等から `haptic('tap')` のように呼べる semantic な
// プリセット。Web では全 no-op (Haptics API は無いため)。
// 内部で発生する Promise の rejection は握り潰す (ユーザー体験には
// 影響しないし、デバイスによっては失敗するため)。
//
//  tap      — 軽いタップ feedback (default)
//  select   — 値の切替 (segmented control 等)
//  pop      — 強い "ポップ" (Heavy 固定。DoubleTapHeart の IG 風ダブルタップ等)
//  confirm  — 確定の合図 (Medium)
//  success  — 完了通知
//  warn     — 警告
//  error    — エラー
//
export type HapticKind = 'tap' | 'select' | 'pop' | 'confirm' | 'success' | 'warn' | 'error';

const enabled = Platform.OS === 'ios' || Platform.OS === 'android';

// ユーザーが設定 > 「触覚フィードバックを減らす」を ON にしているか (2026-06-12 追加)。
// Apple HIG: System Haptics OFF は OS が自動で尊重するが、app 内トグルも提供するのが作法。
// 関数呼び出しの度に getState() で読む (subscribe 不要 — haptic は毎回単発の fire)。
// ※ require 遅延 import: lib/haptics は app 起動の極めて早い段階で import されるため、
//    module 円環や store 初期化順序の問題を避ける。
function suppressed(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    const { useSettingsStore } = require('../stores/settingsStore') as typeof import('../stores/settingsStore');
    return useSettingsStore.getState().reduceHaptics;
  } catch {
    return false;
  }
}

// kind → expo-haptics 呼び出しの唯一のマッピング。haptic() / hap.* は全部ここを通る
async function fire(kind: HapticKind): Promise<void> {
  if (!enabled || suppressed()) return;
  try {
    switch (kind) {
      case 'tap':
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        break;
      case 'select':
        await Haptics.selectionAsync();
        break;
      case 'pop':
        // Heavy 固定 (旧 lib 版は Medium だったが design 版 = DoubleTapHeart の Heavy に統一)
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        break;
      case 'confirm':
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        break;
      case 'success':
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        break;
      case 'warn':
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        break;
      case 'error':
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        break;
    }
  } catch {
    /* silently swallow — haptic は best-effort */
  }
}

export function haptic(kind: HapticKind): void {
  void fire(kind);
}

// ============================================================
// hap — named method 形式 (旧 design/haptics.ts 互換)
// ============================================================
//
// `hap.tap()` のようにドット呼び出しする呼び出し側のための名前空間。
// 各 method は Promise<void> を返す (旧 design 版とシグネチャ一致) が
// rejection は fire() 内で握り潰されるため await 不要。
//
export const hap = {
  tap: (): Promise<void> => fire('tap'),
  confirm: (): Promise<void> => fire('confirm'),
  pop: (): Promise<void> => fire('pop'),
  select: (): Promise<void> => fire('select'),
  success: (): Promise<void> => fire('success'),
  warn: (): Promise<void> => fire('warn'),
  error: (): Promise<void> => fire('error'),
} as const;

// ============================================================
// Legacy primitives (既存 caller のため維持)
// ============================================================
export function impact(style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) {
  if (!enabled || suppressed()) return;
  Haptics.impactAsync(style).catch(() => {});
}

export function notify(type: Haptics.NotificationFeedbackType) {
  if (!enabled || suppressed()) return;
  Haptics.notificationAsync(type).catch(() => {});
}

export function select() {
  if (!enabled || suppressed()) return;
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
    if (!enabled || suppressed()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  },
  medium: (): void => {
    if (!enabled || suppressed()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  },
  heavy: (): void => {
    if (!enabled || suppressed()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
  },
  success: (): void => {
    if (!enabled || suppressed()) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  },
  warning: (): void => {
    if (!enabled || suppressed()) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  },
  error: (): void => {
    if (!enabled || suppressed()) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
  },
} as const;

export type HapticPresetKey = keyof typeof hapticPresets;
