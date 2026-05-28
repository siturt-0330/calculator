// ============================================================
// useColors / useGradients / useShadows — テーマ購読 hook 群
// ------------------------------------------------------------
// 設計:
//   - useResolvedTheme() を購読 → テーマ切替で自動再 render
//   - useMemo で同一テーマ render では同一参照を返し、StyleSheet 比較を破壊しない
//   - 既存の `import { C } from '../design/tokens'` を残しつつ、新規 / 移行
//     対象 component だけ本 hook に切り替えていく gradual migration 戦略
// ============================================================

import { useMemo } from 'react';
import {
  PALETTE_DARK,
  PALETTE_LIGHT,
  GRAD_DARK,
  GRAD_LIGHT,
  SHADOW_DARK,
  SHADOW_LIGHT,
  type ColorPalette,
  type GradientPalette,
  type ShadowSet,
} from '../lib/theme/palettes';
import { useResolvedTheme } from '../lib/theme/themeStore';

/**
 * 現在のテーマの color palette を返す。
 * 使い方:
 *   const C = useColors();
 *   <View style={{ backgroundColor: C.bg }} />
 */
export function useColors(): ColorPalette {
  const theme = useResolvedTheme();
  return useMemo(() => (theme === 'light' ? PALETTE_LIGHT : PALETTE_DARK), [theme]);
}

/**
 * 現在のテーマの gradient palette を返す。
 * 使い方:
 *   const GRAD = useGradients();
 *   <LinearGradient colors={GRAD.primary} />
 */
export function useGradients(): GradientPalette {
  const theme = useResolvedTheme();
  return useMemo(() => (theme === 'light' ? GRAD_LIGHT : GRAD_DARK), [theme]);
}

/**
 * 現在のテーマの shadow set を返す。
 * light テーマでは影が薄めに調整されている (重く見えないように)。
 * 使い方:
 *   const SHADOW = useShadows();
 *   <View style={[styles.card, SHADOW.card]} />
 */
export function useShadows(): ShadowSet {
  const theme = useResolvedTheme();
  return useMemo(() => (theme === 'light' ? SHADOW_LIGHT : SHADOW_DARK), [theme]);
}

/**
 * 1 呼び出しで C / GRAD / SHADOW を全部取りたいときの便利 hook.
 * 内部で別々の useMemo を持つので個別購読と同じ最適化。
 */
export function useTheme(): {
  C: ColorPalette;
  GRAD: GradientPalette;
  SHADOW: ShadowSet;
  isDark: boolean;
} {
  const theme = useResolvedTheme();
  const isDark = theme === 'dark';
  const C = useMemo(() => (isDark ? PALETTE_DARK : PALETTE_LIGHT), [isDark]);
  const GRAD = useMemo(() => (isDark ? GRAD_DARK : GRAD_LIGHT), [isDark]);
  const SHADOW = useMemo(() => (isDark ? SHADOW_DARK : SHADOW_LIGHT), [isDark]);
  return { C, GRAD, SHADOW, isDark };
}
