import { TextStyle } from 'react-native';
import { C } from './tokens';

// パフォーマンス: font weight を削減 — Syne 600 / NotoSansJP 500 / Inter 500
// を排除し、代わりに近い weight (700 / 700 / 600) を使い回す。
// display2 は display (700Bold) に集約。ui は uiBold (600SemiBold) に集約。
// jpM は jpB (700Bold) に集約。FONT.* の API はそのまま、参照先のみ変更。
export const FONT = {
  display: 'Syne_700Bold',
  display2: 'Syne_700Bold',
  ui: 'Inter_600SemiBold',
  uiBold: 'Inter_600SemiBold',
  ui400: 'Inter_400Regular',
  jp: 'NotoSansJP_400Regular',
  jpM: 'NotoSansJP_700Bold',
  jpB: 'NotoSansJP_700Bold',
} as const;

export const T: Record<string, TextStyle> = {
  hero:   { fontFamily: FONT.display,  fontSize: 40, lineHeight: 48, letterSpacing: -0.6 },
  display:{ fontFamily: FONT.display,  fontSize: 34, lineHeight: 40, letterSpacing: -0.5 },
  h1:     { fontFamily: FONT.display2, fontSize: 28, lineHeight: 34, letterSpacing: -0.3 },
  h2:     { fontFamily: FONT.jpB,      fontSize: 22, lineHeight: 30 },
  h3:     { fontFamily: FONT.jpB,      fontSize: 18, lineHeight: 26 },
  h4:     { fontFamily: FONT.jpB,      fontSize: 16, lineHeight: 22 },
  body:   { fontFamily: FONT.jp,       fontSize: 15, lineHeight: 22 },
  bodyM:  { fontFamily: FONT.jpM,      fontSize: 15, lineHeight: 22 },
  bodyMd: { fontFamily: FONT.jpM,      fontSize: 15, lineHeight: 22 },
  bodyB:  { fontFamily: FONT.jpB,      fontSize: 15, lineHeight: 22 },
  small:  { fontFamily: FONT.jp,       fontSize: 13, lineHeight: 18 },
  smallM: { fontFamily: FONT.jpM,      fontSize: 13, lineHeight: 18 },
  smallB: { fontFamily: FONT.jpB,      fontSize: 13, lineHeight: 18 },
  caption:{ fontFamily: FONT.jp,       fontSize: 11, lineHeight: 16 },
  captionM:{ fontFamily: FONT.jpM,     fontSize: 11, lineHeight: 16 },
  num:    { fontFamily: FONT.uiBold,   fontSize: 15, lineHeight: 20, letterSpacing: 0.2 },
  numLg:  { fontFamily: FONT.uiBold,   fontSize: 22, lineHeight: 28 },
  mono:   { fontFamily: FONT.ui,       fontSize: 13, lineHeight: 18, letterSpacing: 0.3 },
  buttonLg: { fontFamily: FONT.jpB,    fontSize: 16, lineHeight: 22 },
  buttonMd: { fontFamily: FONT.jpB,    fontSize: 14, lineHeight: 20 },
  buttonSm: { fontFamily: FONT.jpM,    fontSize: 12, lineHeight: 16 },
} as const;

export const textColor = (kind: 'primary' | 'secondary' | 'tertiary' | 'disabled' = 'primary') => ({
  color:
    kind === 'primary'   ? C.text  :
    kind === 'secondary' ? C.text2 :
    kind === 'tertiary'  ? C.text3 : C.text4,
});
