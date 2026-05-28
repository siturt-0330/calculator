import { Easing, WithSpringConfig, WithTimingConfig } from 'react-native-reanimated';

// ============================================================
// Spring tokens
// ============================================================
//
// 数値は Apple HIG / Apple Photos / Reddit Android の press feedback を
// 参考に「スナップ感」と「自然さ」のバランスで詰めた値。
// `damping` を上げ過ぎると粘る、下げ過ぎると弾みすぎる。
//
//  SPRING_SNAPPY — タップ系 press-feedback の標準 (PressableScale)
//                  キレ良くピタッと戻る。Apple Photos 寄り。
//  SPRING_SOFT   — overlay / sheet / focus ring など重い物の出入り
//  SPRING_BOUNCY — ハートやスタンプ等の「効果」アニメ。少しだけ弾む
//  SPRING_TIGHT  — segmented control / toggle (slider 系) の標準
//  SPRING_GENTLE — progress bar など値の連続変化
//  SPRING_SNAP   — (legacy) 旧 press-feedback 用。互換のため残置
//
export const SPRING_SNAPPY: WithSpringConfig = { damping: 18, stiffness: 300, mass: 0.6 };
export const SPRING_SOFT: WithSpringConfig = { damping: 22, stiffness: 200, mass: 0.8 };
export const SPRING_BOUNCY: WithSpringConfig = { damping: 12, stiffness: 280, mass: 0.7 };
export const SPRING_TIGHT: WithSpringConfig = { damping: 18, stiffness: 320, mass: 0.7 };
export const SPRING_GENTLE: WithSpringConfig = { damping: 22, stiffness: 180, mass: 1 };
// legacy alias — 旧コードがまだ参照しているので残置 (SPRING_SNAPPY に統合予定)
export const SPRING_SNAP: WithSpringConfig = SPRING_SNAPPY;

// ============================================================
// Easing curves
// ============================================================
export const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);
export const EASE_IN_OUT = Easing.bezier(0.65, 0, 0.35, 1);
export const EASE_OUT_BACK = Easing.bezier(0.34, 1.56, 0.64, 1);
// Material Quart-out: タップ後の素早い消失系に。
export const EASE_OUT_QUART = Easing.bezier(0.165, 0.84, 0.44, 1);

// ============================================================
// Timing tokens
// ============================================================
//
//  TIMING_FAST   — 120ms: micro-interaction (focus ring / tap fade)
//  TIMING_NORM   — 220ms: 標準 fade/scale/slide
//  TIMING_NORMAL — alias of TIMING_NORM (legacy)
//  TIMING_SLOW   — 380ms: modal / sheet 等の重め出入り
//
export const TIMING_FAST: WithTimingConfig = { duration: 120, easing: EASE_OUT_QUART };
export const TIMING_NORM: WithTimingConfig = { duration: 220, easing: EASE_OUT };
// legacy alias
export const TIMING_NORMAL: WithTimingConfig = TIMING_NORM;
export const TIMING_SLOW: WithTimingConfig = { duration: 380, easing: EASE_OUT };

// ============================================================
// Component-level magic numbers
// ============================================================
export const PRESS_SCALE = 0.96;
export const PRESS_SCALE_TIGHT = 0.94;
export const FAB_SCALE = 0.92;
export const TAB_INDICATOR = SPRING_TIGHT;
export const HEART_SCALE_KEYFRAMES = [0, 1.3, 1.0, 1.15, 1.0, 0.9, 0] as const;
export const SHIMMER_DURATION = 900;
export const SCREEN_TRANSITION = 280;
export const MODAL_TRANSITION = 320;
export const TOAST_DURATION = 2400;
