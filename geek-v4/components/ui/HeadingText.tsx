// ============================================================
// HeadingText — 見出し用 Text (VoiceOver rotor「見出しナビゲーション」対応)
// ============================================================
// スクリーンリーダーの「見出しジャンプ」(VoiceOver rotor / TalkBack の見出しナビ)
// を機能させる helper (Obsidian: a11y 章 §9.6)。
// - native: accessibilityRole="header" で VoiceOver / TalkBack に見出しとして通知。
// - web: react-native-web 0.19 が accessibilityRole="header" を role="heading" に
//   写像し、aria-level (1〜3) から h1〜h3 要素を選ぶ (AccessibilityUtil/
//   propsToAccessibilityComponent.js でソース確認済 [実証済])。aria-level は
//   forwardedProps に登録済みで DOM まで届く。RNW の Text reset (text$raw:
//   font / margin / padding / display を全上書き) が UA の h1〜h3 既定スタイルを
//   打ち消すため、div → h1〜h3 への要素変更で見た目は 1px も変わらない。
// - style は level → T.h1 / T.h2 / T.h3 を既定とし、呼び出し側 style を後勝ち merge
//   (既存の見た目を維持したい場合は従来どおり style をそのまま渡せばよい)。
// - maxFontSizeMultiplier 1.3: 見出しは Dynamic Type で無制限に拡大させず
//   レイアウト破壊を防ぐ (本文より控えめな上限が Apple の推奨パターン)。
// ============================================================

import { Platform, Text, type TextProps } from 'react-native';
import { T } from '../../design/typography';

export type HeadingTextProps = TextProps & {
  /** 見出しレベル (1〜3)。web では h1〜h3 / aria-level に写像。default 1 */
  level?: 1 | 2 | 3;
};

// level → 既定 style (呼び出し側 style が後勝ちで上書きできる)
const LEVEL_STYLE = { 1: T.h1, 2: T.h2, 3: T.h3 } as const;

// RN 0.76 の TextProps には aria-level が無い (react-native-web 専用 prop) ため、
// web 限定 spread 用の薄い型を切る。native では未知 prop を渡さない (空 object)。
type AriaLevelProps = { 'aria-level'?: number };

export function HeadingText({
  level = 1,
  style,
  maxFontSizeMultiplier,
  ...rest
}: HeadingTextProps) {
  const webA11y: AriaLevelProps =
    Platform.OS === 'web' ? { 'aria-level': level } : {};
  return (
    <Text
      {...rest}
      {...webA11y}
      accessibilityRole="header"
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? 1.3}
      style={[LEVEL_STYLE[level], style]}
    />
  );
}
