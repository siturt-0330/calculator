import { Platform, TextStyle } from 'react-native';
import { C } from './tokens';

// ============================================================
// LOGO_FONT — Apple SF Pro Display 風の "Geek" ブランドテキスト用
// ============================================================
// 過去の Orbitron_900Black (sci-fi/futuristic) は user 体感が
// 「太すぎ・古さ」だったため、Apple system font (SF Pro Display) に切替。
// - iOS: System (= SF Pro / SF Compact 自動)
// - Web: -apple-system stack で Apple device は SF Pro、 他は近似 (Inter)
// - Android: Inter (Google fonts、 SF Pro と humanist 系で類似)
// fontWeight は '700' (Apple Display 推奨の見出し weight) を default に。
// letterSpacing は size に応じて -0.5 〜 -1.2 (Apple Display は negative tracking)。
// ============================================================
export const LOGO_FONT = Platform.select({
  ios: 'System',
  android: 'Inter_700Bold',
  web: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Inter, sans-serif',
  default: 'Inter_700Bold',
}) as string;

export const LOGO_FONT_WEIGHT = '700' as const;

// ============================================================
// Geek ブランドのグラデ塗り (起動スプラッシュ / イントロ / ログイン 共通の単一ソース)
// ============================================================
// 「Geek」ワードマークを起動スプラッシュと同一のグラデ (紫→ラベンダー→ピンク) で塗る。
// size / weight / letterSpacing は呼び出し側で指定し、この helper は「塗り」だけを返す。
//   - web: CSS background-clip:text (react-native-web 0.19.13 が全 prop を DOM へ通すことを
//     ソース追跡で確認済 — color:transparent でも不可視にならない)
//   - native: RN Text はグラデ文字を持てないので単色フォールバック (#B98CFF)
// ★ stop は scripts/web-postbuild.mjs の起動スプラッシュ .gk-word と一致させること。
export const GEEK_GRADIENT_CSS =
  'linear-gradient(120deg, #7C6AF7 0%, #B98CFF 48%, #E891C7 100%)';

type WebTextExtras = {
  backgroundImage?: string;
  backgroundClip?: string;
  WebkitBackgroundClip?: string;
  WebkitTextFillColor?: string;
};
export type GradientTextStyle = TextStyle & WebTextExtras;

export function geekGradientFill(): GradientTextStyle {
  if (Platform.OS === 'web') {
    return {
      color: 'transparent',
      backgroundImage: GEEK_GRADIENT_CSS,
      backgroundClip: 'text',
      WebkitBackgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
    };
  }
  return { color: '#B98CFF' };
}

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

/**
 * Text style alias 集。
 * - 新規 component は Apple HIG 名 (largeTitle / title1〜3 / headline / bodyHig /
 *   callout / subhead / footnote / caption1 / caption2) を推奨。
 * - 既存 alias (hero / display / h1〜h4 / body / small / caption ...) は互換維持
 *   (100+ 箇所で使用中のため変更・削除しない)。
 */
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

  // ============================================================
  // Apple HIG Text Styles (11 種) — Obsidian: Apple Typography 章 §2
  // ------------------------------------------------------------
  // 新規 component はこちらの HIG 名を推奨 (既存 alias は互換維持)。
  // - 'body' は既存 15/22 が 100+ 箇所で使用中のため、HIG の body (17pt) は
  //   'bodyHig' として並列追加する (既存 body の意味は変えない)。
  // - weight は既存規約どおり原則 fontFamily 側で持つ (jpB/jpM=700 集約)。
  //   largeTitle / headline のみ HIG 指定の fontWeight を明示 (既存 component
  //   でも fontFamily + fontWeight 併用は実績ありのパターン)。
  // ============================================================
  largeTitle: { fontFamily: FONT.display, fontSize: 34, lineHeight: 40, fontWeight: '700' },
  title1:   { fontFamily: FONT.display2, fontSize: 28, lineHeight: 34 },
  title2:   { fontFamily: FONT.jpB,      fontSize: 22, lineHeight: 28 },
  title3:   { fontFamily: FONT.jpB,      fontSize: 20, lineHeight: 25 },
  headline: { fontFamily: FONT.jpM,      fontSize: 17, lineHeight: 22, fontWeight: '600' },
  bodyHig:  { fontFamily: FONT.jp,       fontSize: 17, lineHeight: 22 },
  callout:  { fontFamily: FONT.jp,       fontSize: 16, lineHeight: 21 },
  subhead:  { fontFamily: FONT.jp,       fontSize: 15, lineHeight: 20 },
  footnote: { fontFamily: FONT.jp,       fontSize: 13, lineHeight: 18 },
  caption1: { fontFamily: FONT.jp,       fontSize: 12, lineHeight: 16 },
  caption2: { fontFamily: FONT.jp,       fontSize: 11, lineHeight: 13 },
} as const;

export const textColor = (kind: 'primary' | 'secondary' | 'tertiary' | 'disabled' = 'primary') => ({
  color:
    kind === 'primary'   ? C.text  :
    kind === 'secondary' ? C.text2 :
    kind === 'tertiary'  ? C.text3 : C.text4,
});
