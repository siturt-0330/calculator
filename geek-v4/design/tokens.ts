// ============================================================
// C — テーマ追従型カラーパレット (2026-05-31 改修)
// ------------------------------------------------------------
// 193 ファイルが `import { C } from '../design/tokens'` で C を直参照しているが、
// ライトモード切替時にも値が dark のまま固定されて「色合いが変」になる問題が
// あったため、C を mutable 参照に変更して theme 切替で破壊的更新できるよう
// にした。各 importer は object 参照を持ち続けるので、_layout.tsx で
// applyThemeC() + key remount を実行すれば全 193 ファイルが追従する。
//
// 設計:
//   - import { PALETTE_DARK, PALETTE_LIGHT } from '../lib/theme/palettes'
//     を import すると循環参照になるため、palette 値はここに直書きして
//     applyThemeC() で書き換える。 (palettes.ts と shape を完全一致させる)
// ============================================================

import type { ColorPalette, GradientPalette } from '../lib/theme/palettes';

// dark 既定値 (PALETTE_DARK と完全一致 — palettes.ts と二重定義だが循環回避のため)
const _DARK: ColorPalette = {
  bg:   '#0a0a0a',
  bg2:  '#161618',
  bg3:  '#1c1c1c',
  bg4:  '#242424',
  bg5:  '#2c2c2c',
  surfaceHi: '#1a1a1d',
  glass:        'rgba(255,255,255,0.06)',
  glassStrong:  'rgba(255,255,255,0.12)',
  glassBorder:  'rgba(255,255,255,0.10)',
  glassDark:    'rgba(0,0,0,0.50)',
  text:   '#f5f5f7',
  text2:  '#a1a1aa',
  // ★ palettes.ts:PALETTE_DARK と同期: WCAG AA 違反 (2.64:1) を解消
  text3:  '#9CA3AF',
  text4:  '#7B7E8A',
  border:  '#27272a',
  border2: '#3f3f46',
  divider: '#1f1f22',
  accent:       '#7C6AF7',
  accentDeep:   '#5E4FE0',
  accentLight:  '#9F96F9',
  accentSoft:   '#2D2940',
  accentGlow:   'rgba(124,106,247,0.35)',
  accentBg:     '#1e1a3a',
  green:    '#22D3A4',
  greenBg:  '#0d2a22',
  amber:    '#F5A623',
  amberBg:  '#2a1f0d',
  red:      '#E24B4A',
  redBg:    '#2a1010',
  pink:     '#F472B6',
  pinkBg:   '#2a1525',
  blue:     '#3B82F6',
  blueBg:   '#0d1f3a',
  block:           '#cc7070',
  blockBg:         '#1e1010',
  blockBorder:     '#3a2020',
  liked:           '#7C6AF7',
  likedBg:         '#1e1e2e',
  related:         '#7a9a7a',
  relatedBg:       '#1a2a1a',
  relatedBorder:   '#2a4a2a',
  sameGroup:       '#9a7acc',
  sameGroupBg:     '#1e1a2e',
  sameGroupBorder: '#3a2a5a',
  sameGenre:       '#cca87a',
  sameGenreBg:     '#2a2010',
  sameGenreBorder: '#4a3a20',
  trustLow: '#E24B4A',
  trustMid: '#F5A623',
  trustHi:  '#22D3A4',
  scrim:        'rgba(0,0,0,0.75)',
  scrimLight:   'rgba(0,0,0,0.45)',
};

// mutable な現役パレット。export const C はこの参照を返す。
// applyThemeC() で Object.assign による破壊的更新を行うが参照は維持。
const _C: ColorPalette = { ..._DARK };
export const C: ColorPalette = _C;

/**
 * テーマを切り替えて C の中身を破壊的に書き換える。
 * _layout.tsx で resolvedTheme 変化時に呼ばれる + 全 tree を key remount。
 */
export function applyThemeC(palette: ColorPalette): void {
  Object.assign(_C, palette);
}

/**
 * 現在のライブ palette がライトテーマかどうか。
 * C は applyThemeC で破壊的にホットスワップされ、theme 変化時は tree が
 * key remount される。よって render 時に _C.bg を見れば現テーマが分かる
 * (hook を増やさずに「web の CSS gradient だけ theme 分岐」したい箇所で使う)。
 */
export function isLightActive(): boolean {
  return _C.bg !== _DARK.bg;
}

// GRAD も C と同様に theme 連動で差し替える (applyThemeGRAD)。
// 型は dark 既定の as const tuple で固定し (consumer は readonly tuple を維持)、
// 実体配列だけを破壊的に差し替えることで「mutable 化で大量の型エラー」を回避する。
// これで static `import { GRAD }` のロゴ / タブ / FAB 等もライトで自然な青に揃う。
// storyRing / trust / goldBadge は theme 非依存なので据え置き。
export const GRAD = {
  accent:      [_DARK.accent, _DARK.accentDeep] as const,
  accentSoft:  [_DARK.accentLight, _DARK.accent] as const,
  fadeBottom:  ['rgba(10,10,10,0)', _DARK.bg] as const,
  fadeTop:     [_DARK.bg, 'rgba(10,10,10,0)'] as const,
  fadeBottomDark: ['rgba(10,10,10,0)', 'rgba(10,10,10,0.95)'] as const,
  trust:       [_DARK.trustLow, _DARK.trustMid, _DARK.trustHi] as const,
  storyRing:   [_DARK.accent, _DARK.pink, _DARK.amber] as const,
  goldBadge:   ['#F5C842', '#E5A823'] as const,
  primary:     ['#7C6AF7', '#B47AF7', '#F87AB4'] as const,
  primarySoft: ['#7C6AF7', '#6B7AF7'] as const,
  warm:        ['#F87AB4', '#FBAC72'] as const,
  success:     ['#52D49B', '#52C4D4'] as const,
  glass:       ['rgba(124,106,247,0.15)', 'rgba(180,122,247,0.08)', 'rgba(0,0,0,0)'] as const,
  destructive: ['#F87A7A', '#F86B5A'] as const,
} as const;

/**
 * brand gradient を theme に合わせて差し替える (C の applyThemeC と同方針)。
 * 型は上の as const tuple のまま固定し、実体配列だけ破壊的に差し替えるので
 * `colors={GRAD.primary}` の consumer は readonly tuple 型を維持できる。
 * storyRing / trust / goldBadge は theme 非依存なので据え置き。
 * _layout.tsx で applyThemeC と同じタイミングで呼ぶ + 全 tree を key remount。
 */
export function applyThemeGRAD(g: GradientPalette): void {
  // 型は固定したまま実体だけ差し替えるため localized cast (unknown 経由)。
  const m = GRAD as unknown as Record<string, readonly string[]>;
  m.accent = g.accent;
  m.accentSoft = g.accentSoft;
  m.fadeBottom = g.fadeBottom;
  m.fadeTop = g.fadeTop;
  m.fadeBottomDark = g.fadeBottomDark;
  m.primary = g.primary;
  m.primarySoft = g.primarySoft;
  m.warm = g.warm;
  m.success = g.success;
  m.glass = g.glass;
  m.destructive = g.destructive;
}

export const SP = {
  '0': 0,
  '1': 4,
  '2': 8,
  '3': 12,
  '4': 16,
  '5': 20,
  '6': 24,
  '7': 28,
  '8': 32,
  '10': 40,
  '12': 48,
  '16': 64,
  '20': 80,
  '24': 96,
} as const;

export const R = {
  none: 0,
  sm:   6,
  md:   10,
  lg:   14,
  xl:   20,
  '2xl': 28,
  '3xl': 36,
  full: 9999,
} as const;

export const SIZE = {
  touch:        44,
  touchLarge:   56,
  avatarSm:     28,
  avatarMd:     36,
  avatarLg:     56,
  avatarXl:     96,
  iconSm:       16,
  iconMd:       20,
  iconLg:       24,
  iconXl:       28,
  tabBar:       64,
  tabIcon:      26,
  fab:          56,
  topBar:       48,
  topBarLarge:  96,
  input:        48,
  inputLarge:   56,
  buttonSm:     36,
  buttonMd:     48,
  buttonLg:     56,
} as const;

// Refined elevation tokens for the premium card/CTA look.
// Defined here in `tokens.ts` (alongside C / SP / R) so call sites can
// pull a single import: `import { C, SP, SHADOW } from './tokens'`.
// (`design/shadows.ts` は二重定義解消のためこの SHADOW の薄い re-export に
//  一本化済み — single source。new code should prefer the tokens here.)
export const SHADOW = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 6,
  },
  // Subtle "lift" for interactive press states
  cardPress: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 18,
    elevation: 10,
  },
  // Soft accent glow for primary CTAs / focus rings
  accentGlow: {
    shadowColor: '#7C6AF7',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.32,
    shadowRadius: 14,
    elevation: 4,
  },
  // ----- UI Polish (Phase 2) — keep above legacy keys intact -----
  none: {},
  xs: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
  },
  // accent shadow (色付き影 — 紫 glow) — PolishedButton / GradientCard 用
  glow: {
    shadowColor: '#7C6AF7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 6,
  },
} as const;
