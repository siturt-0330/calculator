// ============================================================
// components/feed/feedMediaLayout.ts
// ============================================================
// 単一画像の表示 box スタイルを feed / 投稿詳細 / マイページ で共有する小ユーティリティ。
// 「写真全体を見せる (クロップなし) + コンパクト + 灰色帯なし」を
// 1 箇所に集約し、画面ごとにブレないようにする。
// ============================================================

import type { ViewStyle } from 'react-native';

// カード/詳細の最大幅 (design: web/native 共通で maxWidth:720, paddingHorizontal:16)。
const CARD_MAX_W = 720;
const CARD_PAD_X = 16;

/**
 * 単一画像 box が使える「コンテナ内幅」を winW から算出。
 * card は maxWidth:720 + paddingHorizontal:16 なので、内幅 = min(winW,720) - 32。
 */
export function mediaContainerWidth(winW: number): number {
  const cardW = Math.min(winW > 0 ? winW : CARD_MAX_W, CARD_MAX_W);
  return Math.max(1, cardW - CARD_PAD_X * 2);
}

/**
 * @deprecated mediaItemAspect が box=画像アスペクトを保証するため常に false。
 * 後方互換のため残すが、呼び出し側で contentPosition を設定する必要はない。
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function mediaIsCropped(_aspect: number, _containerW?: number, _maxH?: number): boolean {
  return false;
}

/**
 * 単一画像 box のスタイル。aspect = width/height。
 * ★ 「全体表示 + コンパクト + 灰色帯なし」の両立方針:
 *   1. 横長/適度な縦長 (自然高さ <= maxH):
 *      width = containerW / height = naturalH → カード幅いっぱい × 自然高さ
 *      → クロップなし・灰色帯なし ✓
 *   2. 縦長 (自然高さ > maxH):
 *      height = maxH / width = maxH × aspect → 高さ cap + 幅を比例縮小
 *      → box が画像アスペクトと一致 → contentFit="contain" で全体表示
 *      → クロップなし・灰色帯なし ✓ (画像は縮小されるが全体が見える)
 *   ★ 縦長で幅縮小した際はカード中央に寄せるため alignSelf:'center' を mediaItemBase に付与推奨。
 *   containerW 不明時のみ従来の比率方式にフォールバック (FlashList 起動直後の保険)。
 */
export function mediaItemAspect(aspect: number, containerW?: number, maxH?: number): ViewStyle {
  const ar = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  const cw = containerW && containerW > 0 && Number.isFinite(containerW) ? containerW : 0;
  if (!cw) {
    // フォールバック (containerW 不明): 比率方式 + 0潰れ保険。通常経路では使われない。
    return { width: '100%', aspectRatio: ar, minHeight: 120 };
  }
  const naturalH = cw / ar;
  const cap = maxH && maxH > 0 && Number.isFinite(maxH) ? maxH : naturalH;

  if (naturalH <= cap + 0.5) {
    // 自然高さが上限以下: カード幅いっぱい × 自然高さ (クロップなし・灰色帯なし)
    return { width: Math.max(1, Math.round(cw)), height: Math.max(1, Math.round(naturalH)) };
  }
  // 自然高さが上限超: 高さを cap、幅を cap × ar で比例縮小
  // → box が画像アスペクトと一致するためクロップなし・灰色帯なし (画像は縮小表示)
  const h = Math.max(1, Math.round(cap));
  const w = Math.max(1, Math.round(cap * ar));
  return { width: w, height: h };
}
