// ============================================================
// components/feed/feedMediaLayout.ts
// ============================================================
// 単一画像の表示 box スタイルを feed / 投稿詳細 / マイページ で共有する小ユーティリティ。
// 「写真全体を見せる (contain) + コンパクト + 縦写真は中央寄せの細box (左右レターボックス
// 無し)」を 1 箇所に集約し、画面ごとにブレないようにする。
// ============================================================

import type { ViewStyle } from 'react-native';

export const MEDIA_MAX_ASPECT = 1.91; // ≈1.91:1 (最も横長の上限)

/**
 * 単一画像 box のスタイル。aspect = width/height。
 *  - 縦長 (aspect<1): 高さを portraitMaxH で固定し 幅=高さ×真の比 の中央寄せ細box。
 *    box=画像比なので左右レターボックス無しで全体表示。下限 0.5 (1:2) で細すぎ防止。
 *  - 横長/正方: 全幅・比で高さ決定。超横長のみ 1.91 で上限。
 */
export function mediaItemAspect(aspect: number, portraitMaxH?: number): ViewStyle {
  if (aspect < 1 && portraitMaxH && portraitMaxH > 0) {
    return { height: portraitMaxH, aspectRatio: Math.max(0.5, aspect), alignSelf: 'center', maxWidth: '100%' };
  }
  return { width: '100%', aspectRatio: Math.min(MEDIA_MAX_ASPECT, Math.max(1, aspect)) };
}
