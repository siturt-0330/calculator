import { forwardRef } from 'react';
import { Text, TextProps } from 'react-native';

// ============================================================
// AppText — Dynamic Type (iOS 文字サイズ設定) 追従の Text ラッパー
// ============================================================

/**
 * Apple「Larger Text Evaluation Criteria」対応の部分実装。
 * OS の文字サイズ設定 (Dynamic Type) に追従しつつ、レイアウト破壊を防ぐため
 * 拡大率に用途別の上限 (maxFontSizeMultiplier) を掛ける。
 *
 * - `body`  (default): 本文・説明文。1.6 倍まで拡大を許容
 * - `ui`             : ボタン・ラベル等の UI 部品。1.3 倍まで
 * - `fixed`          : バッジ・装飾 emoji 等、拡大するとレイアウトが壊れる箇所。拡大しない (1.0)
 *
 * 新規 component は素の `Text` ではなく本 wrapper の使用を推奨。
 * 既存画面への一括適用はレイアウト回帰リスクがあるため行わない (実例: ErrorBoundary / EmptyState)。
 */
type Props = TextProps & { scale?: 'body' | 'ui' | 'fixed' };

const MULTIPLIER: Record<NonNullable<Props['scale']>, number> = {
  body: 1.6,
  ui: 1.3,
  fixed: 1.0,
};

export const AppText = forwardRef<Text, Props>(function AppText(
  { scale = 'body', ...rest },
  ref,
) {
  // rest を後ろに spread — 呼び出し側が maxFontSizeMultiplier を明示した場合はそちらを優先
  return <Text ref={ref} maxFontSizeMultiplier={MULTIPLIER[scale]} {...rest} />;
});
