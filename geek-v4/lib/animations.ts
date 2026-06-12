import { Easing, type WithTimingConfig } from 'react-native-reanimated';
import { SPRING_BOUNCY, SPRING_GENTLE, SPRING_SNAPPY, SPRING_SOFT } from '../design/motion';

// ============================================================
// lib/animations.ts — Reanimated 3 アニメーションプリセット
// ============================================================
//
// design/motion.ts に置いてある低レベル primitive (SPRING_SNAPPY 等) と
// 別レイヤで、汎用名 (snappy / gentle / bouncy / smooth, fast / medium / slow)
// で揃えた "プリセット集"。worklet 経由でも安全に渡せる plain object を export する。
//
// 使い分け:
//   - design/motion.ts: 既存コンポーネントが直接参照する具体的な数値セット
//   - lib/animations.ts: 新規ロジックや fast/medium/slow 等で抽象的に
//                       選びたい場面の名前付きプリセット
//
// すべての値は plain object literal なので、worklet クロージャに入れても
// JS スレッドからの参照不要で安全に使える (sharedValue 越しと同じ性質)。
//

// ============================================================
// SPRING プリセット
// ============================================================
//
//   snappy  — タップ系 press-feedback / segmented control 系の "ピタッと止まる" 動き
//   gentle  — overlay / banner などの落ち着いた出入り
//   bouncy  — ハートや絵文字 stamp 等のお祝い系。少し弾む
//   smooth  — modal / sheet 等、滑らかに収束させたいとき
//
// ★ 物理値は design/motion.ts を single source of truth として参照する。
//   かつて同名 'snappy' がここだけ別物理 ({25,250,1}) を持つ split-brain が
//   あったため、独自数値の直書きを廃止 (2026-06-12)。
//
export const SPRING_PRESETS = {
  snappy: SPRING_SNAPPY,
  gentle: SPRING_GENTLE,
  bouncy: SPRING_BOUNCY,
  smooth: SPRING_SOFT,
} as const;

// ============================================================
// TIMING プリセット
// ============================================================
//
//   fast    — 200ms: micro-interaction (focus / chip toggle / fade)
//   medium  — 300ms: 標準 fade / slide / scale
//   slow    — 450ms: 重めの modal / sheet 出入り
//
export const TIMING_PRESETS = {
  fast: { duration: 200, easing: Easing.out(Easing.cubic) } satisfies WithTimingConfig,
  medium: { duration: 300, easing: Easing.inOut(Easing.cubic) } satisfies WithTimingConfig,
  slow: { duration: 450, easing: Easing.inOut(Easing.cubic) } satisfies WithTimingConfig,
} as const;

// ============================================================
// iOS-style 標準 duration (ms)
// ============================================================
//
// Reanimated 以外 (LayoutAnimation / setTimeout / CSS transition 等) で
// 同じ "リズム" を揃えたい場面で使う。TIMING_PRESETS の duration とも一致。
//
export const DURATIONS = {
  short: 200,
  medium: 300,
  long: 450,
} as const;

export type SpringPresetName = keyof typeof SPRING_PRESETS;
export type TimingPresetName = keyof typeof TIMING_PRESETS;
export type DurationName = keyof typeof DURATIONS;
