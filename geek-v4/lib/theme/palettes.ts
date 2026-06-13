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
  // ★ 2026-06-12: WCAG AA 違反 (text3 4.13:1 / text4 2.64:1 on #0a0a0a) を解消。
  //   Apple HIG: 本文 4.5:1 / 大文字 3.0:1 (AAA 推奨 7:1)。
  //   text3 = #9CA3AF (4.93:1 — 本文 AA 合格)
  //   text4 = #7B7E8A (3.42:1 — 大文字 AA 合格、icon/補助テキスト用)
  //   light は変えない (text3 #71717a on #fff = 4.79:1 で既に AA pass)。
  //   再発防止は tests/unit/wcagContrastLock.test.ts でガード。
  text3: '#9CA3AF',
  text4: '#7B7E8A',

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
// Light palette — 「白基調 + 黒文字」 (2026-06-13 モノトーン改修)
// ------------------------------------------------------------
// 設計指針 (ユーザー要望で青を撤去・モノトーン化):
//   - bg は純白 (#ffffff)。text は #1a1a1a (純黒 #000 はコントラスト過剰)
//   - accent は「自然な青」(#3E6DA3) → **チャコール (#1d1d1f)** に変更。
//     Apple HIG の neutral system gray 系で揃え、白背景での「青っぽさ」を排除。
//     アクション/選択は色ではなく濃度差で示す。
//   - liked/blue/sameGroup などのセマンティック色も青/紫を抑え slate-gray 系へ。
//   - 警告色 (red/amber/green) は WCAG AA を満たす濃いめの色を維持
//     (機能を表す赤/黄/緑は識別のため残す)。
//   - glass は黒 base のまま (白背景に rgba(255,255,255,*) は見えない)。
// ============================================================
// ★ 2026-06-13 ライト精緻化: 「青み (zinc/slate) を完全に排した *純 neutral グレー*」へ。
//   - 全グレーを r=g=b の真ニュートラルにし、白背景で青っぽく見えないようにする
//     (zinc は僅かに b>r で寒色寄り / slate は更に青く、ユーザーの「青を避けて」に反する)。
//   - text2 を一段濃く (neutral-700) して階層を明瞭に。罫線/影は控えめだが視認可。
//   - WCAG: text/text2/text3 ≥ 4.5:1、text4 ≥ 3.0:1 を維持 (wcagContrastLock.test.ts)。
export const PALETTE_LIGHT: ColorPalette = {
  bg: '#ffffff',
  bg2: '#f7f7f7',      // カード面 — ごく淡い純グレー
  bg3: '#efefef',      // 入力 / チップ
  bg4: '#e6e6e6',      // 押下 / hover
  bg5: '#d6d6d6',
  surfaceHi: '#fbfbfb',

  glass: 'rgba(0,0,0,0.04)',
  glassStrong: 'rgba(0,0,0,0.08)',
  glassBorder: 'rgba(0,0,0,0.14)',
  glassDark: 'rgba(255,255,255,0.72)',

  text: '#171717',     // neutral-900 — 純黒は避けた上質な濃墨
  text2: '#404040',    // neutral-700 — 強めの 2 次テキストで階層を明瞭に (~10:1)
  text3: '#737373',    // neutral-500 — 4.75:1 (本文 AA 合格)
  // ★ text4 は AA 大文字 3.0:1 を満たす最も淡い純グレー
  text4: '#8f8f8f',    // 3.2:1

  border: '#d6d6d6',   // 視認できるが上品な純グレーの罫線 (青みなし)
  border2: '#a3a3a3',  // 強調線 (neutral-400)
  divider: '#e4e4e4',  // 行区切り — 控えめ

  // モノトーン: アクセントは純 neutral のチャコール (白で ~17:1)。
  accent: '#171717',
  accentDeep: '#000000',
  accentLight: '#9a9a9a',  // 淡い純グレー (装飾/枠線用)
  accentSoft: '#f0f0f0',   // 選択中の極薄グレー背景
  accentGlow: 'rgba(0,0,0,0.10)',
  accentBg: '#f0f0f0',

  green: '#059669',
  greenBg: '#ECFDF5',
  amber: '#D97706',
  amberBg: '#FEF3C7',
  red: '#DC2626',
  redBg: '#FEE2E2',
  pink: '#DB2777',
  pinkBg: '#FCE7F3',
  // ★ blue セマンティック枠も青み (slate #475569) を撤去し純 neutral に。
  blue: '#404040',
  blueBg: '#f0f0f0',

  block: '#B91C1C',
  blockBg: '#FEE2E2',
  blockBorder: '#FECACA',

  // いいねもアクセントと統一 (モノトーン)
  liked: '#171717',
  likedBg: '#f0f0f0',

  related: '#15803D',
  relatedBg: '#ECFDF5',
  relatedBorder: '#BBF7D0',

  // sameGroup も純 neutral に (旧 zinc は僅かに寒色)
  sameGroup: '#404040',
  sameGroupBg: '#f4f4f4',
  sameGroupBorder: '#e4e4e4',

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
  // ★ モノトーン化 (2026-06-13): light 専用 brand grad の青 (#3E6DA3〜#6FA3CC) を撤去。
  //   チャコール〜ミディアムグレーで濃淡のみ示す。tab pill / FAB / CTA など
  //   全 light モードのアクセントが「青」から「黒/グレー」に統一される。
  //   ※ Geek 起動スプラッシュの紫グラデは design/typography.ts (GEEK_GRADIENT_CSS)
  //     が別 source of truth なので無影響 (CLAUDE.md §0 ロック)。
  primary: ['#1d1d1f', '#3a3a3c', '#6e6e73'] as const, // 黒〜グレーの濃淡
  primarySoft: ['#1d1d1f', '#3a3a3c'] as const,         // チャコール濃淡
  warm: ['#3a3a3c', '#6e6e73'] as const,                // やわらかいグレー
  success: ['#3DBE88', '#3DAEBA'] as const,
  glass: ['rgba(0,0,0,0.08)', 'rgba(0,0,0,0.04)', 'rgba(0,0,0,0)'] as const,
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

// SHADOW_LIGHT — ライトモード用の影セット (2026-06-13 純 neutral 化 + 上質化)
// shadowColor を青み (slate #94a3b8) → 純 neutral グレー (#9a9a9a) に。
// opacity を少し下げ radius を広げて「白に溶ける柔らかな浮遊感」へ振り直す
// (硬い影をやめてカードが上品に浮く)。accentGlow/glow は neutral の #3a3a3c。
export const SHADOW_LIGHT: ShadowSet = {
  none: {} as Record<string, never>,
  xs: {
    shadowColor: '#9a9a9a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.10,
    shadowRadius: 3,
    elevation: 1,
  },
  sm: {
    shadowColor: '#9a9a9a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.11,
    shadowRadius: 8,
    elevation: 2,
  },
  md: {
    shadowColor: '#9a9a9a',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 3,
  },
  card: {
    shadowColor: '#9a9a9a',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.13,
    shadowRadius: 18,
    elevation: 3,
  },
  cardPress: {
    shadowColor: '#9a9a9a',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.16,
    shadowRadius: 26,
    elevation: 4,
  },
  accentGlow: {
    shadowColor: '#3a3a3c',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 3,
  },
  glow: {
    shadowColor: '#3a3a3c',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
    elevation: 4,
  },
};
