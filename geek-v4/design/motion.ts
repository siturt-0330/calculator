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
//  SPRING_SEGMENT — Apple Segmented Control 風の indicator slide / 画面 enter。
//                   ScopeToggle・投稿詳細 enter で使っていた inline {22,240,0.7} を統合
//                   (値は当時の指示書準拠のまま — 体感不変)。
export const SPRING_SEGMENT: WithSpringConfig = { damping: 22, stiffness: 240, mass: 0.7 };
//  SPRING_SLIDE_SOFT — mass 1 既定のやや柔らかい indicator slide (admin タブ pill)。
//                      SPRING_SEGMENT より一拍ゆったり収束する。
export const SPRING_SLIDE_SOFT: WithSpringConfig = { damping: 22, stiffness: 220, mass: 1 };
//  SPRING_POP_SOFT — ゆったり弾む出現ポップ (Avatar の emoji fallback mount 等)。
//                    SPRING_BOUNCY より遅く・柔らかい登場感。
export const SPRING_POP_SOFT: WithSpringConfig = { damping: 12, stiffness: 180, mass: 1 };
//  SPRING_PRESS_QUICK — 小型 chip の素早い押下→復帰 (AI 提案 chip 等)。
//                       SPRING_SNAPPY より硬く速い。わずかに弾んで戻る。
export const SPRING_PRESS_QUICK: WithSpringConfig = { damping: 14, stiffness: 360, mass: 0.6 };
//  SPRING_LIQUID — Liquid Glass TabBar (indicator slide / pill⇄ball morph) 専用。
//  知覚ベース API (duration/dampingRatio)。Apple WWDC23 の spring ガイダンス
//  (bounce ≈ 0.2 — 「UI 要素は 0.4 以下」警告レンジ内) ベース。
//  v5 (2026-06-12): 300ms/0.8 — morph を transform-only 化したのに合わせ、
//  収縮もキビキビ寄りに短縮 (350→300ms)。
//  ※ physics 系 (damping/stiffness) と知覚系 (duration/dampingRatio) は混在不可。
export const SPRING_LIQUID: WithSpringConfig = { duration: 300, dampingRatio: 0.8 };
//  SPRING_LIQUID_FAST — TabBar 展開 (ball → pill) 専用の速い spring。
//  展開が遅いと「タブ操作したいのに待たされる」UX になるため、収縮より大幅に速く。
//  v5: 220→180ms / 0.88→0.85 (わずかな弾みを残しつつ即応)。
//  ユーザー指示「もっともっとぬるぬる早くスムーズに」(2026-06-12)。
export const SPRING_LIQUID_FAST: WithSpringConfig = { duration: 180, dampingRatio: 0.85 };

// ============================================================
// Apple 知覚 spring presets (SwiftUI 互換)
// ============================================================
//
// SwiftUI の .smooth / .snappy / .bouncy に対応する知覚ベース preset
// (Obsidian「Apple モーション」章準拠)。reanimated の withSpring は
// duration を **ms** で受ける (SwiftUI は秒) ことに注意。
// SPRING_LIQUID と同じ { duration, dampingRatio } フォーマット
// (※ physics 系 damping/stiffness と混在不可)。
//
export const SPRING_SMOOTH_P: WithSpringConfig = { duration: 500, dampingRatio: 1.0 }; // SwiftUI .smooth
export const SPRING_SNAPPY_P: WithSpringConfig = { duration: 300, dampingRatio: 0.85 }; // SwiftUI .snappy
export const SPRING_BOUNCY_P: WithSpringConfig = { duration: 500, dampingRatio: 0.7 }; // SwiftUI .bouncy

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
// Gesture → spring velocity handoff
// ============================================================
// ジェスチャ解放時の指の速度 (px/s を panel 幅で割り progress/s に正規化済) を
// withSpring の `velocity` に渡す前に整える worklet ヘルパー:
//   (1) 目標方向と同符号の成分だけ採用 — 逆フリック時の不自然な overshoot を防ぐ
//   (2) 絶対値に上限 (MAX) を掛ける — 端末由来の過大初速でバネが暴れるのを防ぐ
// これにより「指を払って離した瞬間そのままスッと吸い付く」連続感を出しつつ、
// 端末差・誤爆フリックを吸収する。HomeDrawer / feed の open・close 両方で共用。
export function clampHandoff(vNorm: number, toValue: number): number {
  'worklet';
  const MAX = 8; // progress/s の上限 (≈ VEL_THRESHOLD の数倍 / 画面幅)
  const v = Math.max(-MAX, Math.min(MAX, vNorm));
  // toValue=0 (閉じる/戻す) は負方向、toValue=1 (開く) は正方向の速度のみ採用
  return toValue === 0 ? Math.min(0, v) : Math.max(0, v);
}

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
