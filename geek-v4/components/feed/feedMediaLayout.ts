// ============================================================
// components/feed/feedMediaLayout.ts
// ============================================================
// 単一画像の表示 box スタイルを feed / 投稿詳細 / マイページ で共有する小ユーティリティ。
// 「写真全体を見せる (contain) + コンパクト + 縦写真は中央寄せの細box (レターボックス無し)」を
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
 * 単一画像が「高さ上限で切り取られる(=cover crop)」か。
 * 全幅にしたときの自然高さ (containerW/比) が maxH を超えるとき true。
 * true のとき呼び出し側は contentPosition='top' で「上端」を見せる
 * (中央 crop だと真ん中しか写らず文脈が消えるため)。タップで全体表示できる。
 */
export function mediaIsCropped(aspect: number, containerW?: number, maxH?: number): boolean {
  if (!maxH || maxH <= 0 || !Number.isFinite(maxH)) return false;
  const ar = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  const cw = containerW && containerW > 0 && Number.isFinite(containerW) ? containerW : 0;
  if (!cw) return false;
  return cw / ar > maxH + 0.5;
}

/**
 * 単一画像 box のスタイル。aspect = width/height。
 * ★ 「カード幅いっぱい(謎の余白なし) + 高さは maxH で頭打ち(コンパクト)」が基本:
 *     width  = containerW                         … 常に幅いっぱい → 左右の余白が出ない
 *     height = min(containerW / 比, maxH)          … 自然高さを maxH で頭打ち(縦に伸びすぎない)
 *   - 横長/短い画像 (自然高さ <= maxH): box=画像比 → cover でも全体表示 (クロップ無し・灰色帯無し)
 *   - 縦長 (自然高さ > maxH): maxH で頭打ち → cover + contentPosition='top' で上端を大きく表示。
 *     これで「縦に大きすぎて次の投稿が見えない」を解消しつつ、中央 crop の「真ん中しか写らない」も回避。
 *   明示ピクセル数値なので FlashList recycled cell の高さ0潰れも起きない。
 *  containerW 不明時のみ従来の比率方式にフォールバック (保険の minHeight 付き)。
 *  画面回転/リサイズ時は呼び出し側が useWindowDimensions で再 render → 寸法が追従する。
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
  const w = Math.max(1, Math.round(cw));
  const h = Math.max(1, Math.round(Math.min(naturalH, cap)));
  return { width: w, height: h };
}
