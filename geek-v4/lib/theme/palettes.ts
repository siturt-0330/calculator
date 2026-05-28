// ============================================================
// テーマパレット (dark / light)
// ------------------------------------------------------------
// design/tokens.ts の `C` は dark 固定で、import している既存 component が
// 200+ ある。それを全置換せずに済むよう、テーマ切り替えの "本体" を
// ここに定義し、対象画面 (feed / community / post detail) だけが `useColors()`
// で本 palette を購読する。
//
// `PALETTE_DARK` は `design/tokens.ts` の `C` と完全一致するように手で揃える
// (将来は `C = PALETTE_DARK` に統合したいが、循環 import になりがちなので
//  段階移行)。
// ============================================================

// 1 つの palette が持つキー一覧。`C` と同じ shape にする。
export type ColorPalette = {
  bg: string;
  bg2: string;
  bg3: string;
  bg4: string;
  bg5: string;
  surfaceHi: string;

  glass: string;
  glassStrong: string;
  glassBorder: string;
  glassDark: string;

  text: string;
  text2: string;
  text3: string;
  text4: string;

  border: string;
  border2: string;
  divider: string;

  accent: string;
  accentDeep: string;
  accentLight: string;
  accentSoft: string;
  accentGlow: string;
  accentBg: string;

  green: string;
  greenBg: string;
  amber: string;
  amberBg: string;
  red: string;
  redBg: string;
  pink: string;
  pinkBg: string;
  blue: string;
  blueBg: string;

  block: string;
  blockBg: string;
  blockBorder: string;

  liked: string;
  likedBg: string;

  related: string;
  relatedBg: string;
  relatedBorder: string;

  sameGroup: string;
  sameGroupBg: string;
  sameGroupBorder: string;

  sameGenre: string;
  sameGenreBg: string;
  sameGenreBorder: string;

  trustLow: string;
  trustMid: string;
  trustHi: string;

  scrim: string;
  scrimLight: string;
};

// ============================================================
// Dark palette — 既存の design/tokens.ts `C` と完全一致。
// ============================================================
export const PALETTE_DARK: ColorPalette = {
  bg: '#0a0a0a',
  bg2: '#161618',
  bg3: '#1c1c1c',
  bg4: '#242424',
  bg5: '#2c2c2c',
  surfaceHi: '#1a1a1d',

  glass: 'rgba(255,255,255,0.06)',
  glassStrong: 'rgba(255,255,255,0.12)',
  glassBorder: 'rgba(255,255,255,0.10)',
  glassDark: 'rgba(0,0,0,0.50)',

  text: '#f5f5f7',
  text2: '#a1a1aa',
  text3: '#71717a',
  text4: '#52525b',

  border: '#27272a',
  border2: '#3f3f46',
  divider: '#1f1f22',

  accent: '#7C6AF7',
  accentDeep: '#5E4FE0',
  accentLight: '#9F96F9',
  accentSoft: '#2D2940',
  accentGlow: 'rgba(124,106,247,0.35)',
  accentBg: '#1e1a3a',

  green: '#22D3A4',
  greenBg: '#0d2a22',
  amber: '#F5A623',
  amberBg: '#2a1f0d',
  red: '#E24B4A',
  redBg: '#2a1010',
  pink: '#F472B6',
  pinkBg: '#2a1525',
  blue: '#3B82F6',
  blueBg: '#0d1f3a',

  block: '#cc7070',
  blockBg: '#1e1010',
  blockBorder: '#3a2020',

  liked: '#7C6AF7',
  likedBg: '#1e1e2e',

  related: '#7a9a7a',
  relatedBg: '#1a2a1a',
  relatedBorder: '#2a4a2a',

  sameGroup: '#9a7acc',
  sameGroupBg: '#1e1a2e',
  sameGroupBorder: '#3a2a5a',

  sameGenre: '#cca87a',
  sameGenreBg: '#2a2010',
  sameGenreBorder: '#4a3a20',

  trustLow: '#E24B4A',
  trustMid: '#F5A623',
  trustHi: '#22D3A4',

  scrim: 'rgba(0,0,0,0.75)',
  scrimLight: 'rgba(0,0,0,0.45)',
};

// ============================================================
// Light palette — Apple HIG / Material 3 を参考に「白基調 + 黒文字」。
// ------------------------------------------------------------
// 設計指針:
//   - bg は純白 (#fff) ではなく僅かに灰色寄り (#fafafa) — 純白は眩しすぎ
//   - text は #1a1a1a (純黒 #000 はコントラスト過剰)
//   - accent は dark と同じ紫 #7C6AF7 を維持 — ブランド identity 保持
//   - 警告色 (red/amber/green) は WCAG AA を満たす濃いめの色を選択
//   - glass は黒 base に変更 (白背景に rgba(255,255,255,*) は見えない)
// ============================================================
export const PALETTE_LIGHT: ColorPalette = {
  bg: '#ffffff',
  bg2: '#f7f7f9',
  bg3: '#f1f1f4',
  bg4: '#e9e9ee',
  bg5: '#dedee4',
  surfaceHi: '#fafafc',

  glass: 'rgba(0,0,0,0.04)',
  glassStrong: 'rgba(0,0,0,0.08)',
  glassBorder: 'rgba(0,0,0,0.08)',
  glassDark: 'rgba(255,255,255,0.70)',

  text: '#1a1a1a',
  text2: '#52525b',
  text3: '#71717a',
  text4: '#a1a1aa',

  border: '#e4e4e7',
  border2: '#d4d4d8',
  divider: '#ececef',

  accent: '#6B5BE8',   // dark より気持ち濃い (白背景でも見えるように)
  accentDeep: '#4F3FCC',
  accentLight: '#8C7FF0',
  accentSoft: '#EEE8FF',
  accentGlow: 'rgba(107,91,232,0.25)',
  accentBg: '#F5F2FF',

  green: '#059669',
  greenBg: '#ECFDF5',
  amber: '#D97706',
  amberBg: '#FEF3C7',
  red: '#DC2626',
  redBg: '#FEE2E2',
  pink: '#DB2777',
  pinkBg: '#FCE7F3',
  blue: '#2563EB',
  blueBg: '#DBEAFE',

  block: '#B91C1C',
  blockBg: '#FEE2E2',
  blockBorder: '#FECACA',

  liked: '#6B5BE8',
  likedBg: '#F5F2FF',

  related: '#15803D',
  relatedBg: '#ECFDF5',
  relatedBorder: '#BBF7D0',

  sameGroup: '#7E22CE',
  sameGroupBg: '#F3E8FF',
  sameGroupBorder: '#E9D5FF',

  sameGenre: '#A16207',
  sameGenreBg: '#FEF3C7',
  sameGenreBorder: '#FDE68A',

  trustLow: '#DC2626',
  trustMid: '#D97706',
  trustHi: '#059669',

  scrim: 'rgba(0,0,0,0.45)',
  scrimLight: 'rgba(0,0,0,0.20)',
};

// ============================================================
// グラデーション (テーマ差分あり)
// ------------------------------------------------------------
// dark の fadeBottom は bg=#0a0a0a へフェードする。light では bg=#fff へ
// フェードする必要があるので、palette とは別に theme-aware で持つ。
// ============================================================
export type GradientPalette = {
  accent: readonly [string, string];
  accentSoft: readonly [string, string];
  fadeBottom: readonly [string, string];
  fadeTop: readonly [string, string];
  fadeBottomDark: readonly [string, string];
  primary: readonly [string, string, string];
  primarySoft: readonly [string, string];
  warm: readonly [string, string];
  success: readonly [string, string];
  glass: readonly [string, string, string];
  destructive: readonly [string, string];
};

export const GRAD_DARK: GradientPalette = {
  accent: [PALETTE_DARK.accent, PALETTE_DARK.accentDeep] as const,
  accentSoft: [PALETTE_DARK.accentLight, PALETTE_DARK.accent] as const,
  fadeBottom: ['rgba(10,10,10,0)', PALETTE_DARK.bg] as const,
  fadeTop: [PALETTE_DARK.bg, 'rgba(10,10,10,0)'] as const,
  fadeBottomDark: ['rgba(10,10,10,0)', 'rgba(10,10,10,0.95)'] as const,
  primary: ['#7C6AF7', '#B47AF7', '#F87AB4'] as const,
  primarySoft: ['#7C6AF7', '#6B7AF7'] as const,
  warm: ['#F87AB4', '#FBAC72'] as const,
  success: ['#52D49B', '#52C4D4'] as const,
  glass: ['rgba(124,106,247,0.15)', 'rgba(180,122,247,0.08)', 'rgba(0,0,0,0)'] as const,
  destructive: ['#F87A7A', '#F86B5A'] as const,
};

export const GRAD_LIGHT: GradientPalette = {
  accent: [PALETTE_LIGHT.accent, PALETTE_LIGHT.accentDeep] as const,
  accentSoft: [PALETTE_LIGHT.accentLight, PALETTE_LIGHT.accent] as const,
  fadeBottom: ['rgba(255,255,255,0)', PALETTE_LIGHT.bg] as const,
  fadeTop: [PALETTE_LIGHT.bg, 'rgba(255,255,255,0)'] as const,
  fadeBottomDark: ['rgba(255,255,255,0)', 'rgba(255,255,255,0.95)'] as const,
  // brand grad はテーマ問わず同一色 — Geek の identity を保持
  primary: ['#6B5BE8', '#A66AE0', '#E55BA0'] as const,
  primarySoft: ['#6B5BE8', '#5A6CD8'] as const,
  warm: ['#E55BA0', '#E89B5C'] as const,
  success: ['#3DBE88', '#3DAEBA'] as const,
  glass: ['rgba(107,91,232,0.10)', 'rgba(166,106,224,0.06)', 'rgba(0,0,0,0)'] as const,
  destructive: ['#E55B5B', '#E0533F'] as const,
};

// ============================================================
// SHADOW (テーマ差分あり)
// ------------------------------------------------------------
// dark では #000 の影が強く出る。light では同じ強度の影だと「重すぎる」
// 印象になるので、shadowOpacity を 約 40% に下げる + radius も小さくする。
// ============================================================
export type ShadowSet = {
  none: Record<string, never>;
  xs: object;
  sm: object;
  md: object;
  card: object;
  cardPress: object;
  accentGlow: object;
  glow: object;
};

export const SHADOW_DARK: ShadowSet = {
  none: {} as Record<string, never>,
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
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 6,
  },
  cardPress: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 18,
    elevation: 10,
  },
  accentGlow: {
    shadowColor: '#7C6AF7',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.32,
    shadowRadius: 14,
    elevation: 4,
  },
  glow: {
    shadowColor: '#7C6AF7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 6,
  },
};

export const SHADOW_LIGHT: ShadowSet = {
  none: {} as Record<string, never>,
  xs: {
    shadowColor: '#0a0a0a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  sm: {
    shadowColor: '#0a0a0a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  md: {
    shadowColor: '#0a0a0a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  card: {
    shadowColor: '#0a0a0a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.10,
    shadowRadius: 14,
    elevation: 4,
  },
  cardPress: {
    shadowColor: '#0a0a0a',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.14,
    shadowRadius: 20,
    elevation: 6,
  },
  accentGlow: {
    shadowColor: '#6B5BE8',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.20,
    shadowRadius: 14,
    elevation: 3,
  },
  glow: {
    shadowColor: '#6B5BE8',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 4,
  },
};
