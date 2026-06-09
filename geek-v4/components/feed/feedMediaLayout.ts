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

// 縦長の頭打ちアスペクト (9:16)。これより縦長 (縦コラージュ/超縦長ポスター等) だけ
// この比で頭打ちにして cover(上端) で大きく見せる。普通の縦長 (4:5/3:4/2:3/9:16) は
// すべて「全幅・写真全体」で表示される。X/Threads と同じ発想。
export const MEDIA_MIN_ASPECT = 0.5625;

/**
 * 単一画像 box が使える「コンテナ内幅」を winW から算出。
 * card は maxWidth:720 + paddingHorizontal:16 なので、内幅 = min(winW,720) - 32。
 */
export function mediaContainerWidth(winW: number): number {
  const cardW = Math.min(winW > 0 ? winW : CARD_MAX_W, CARD_MAX_W);
  return Math.max(1, cardW - CARD_PAD_X * 2);
}

/**
 * 単一画像が「頭打ち(cover で上端crop)」されるか。aspect < 9:16 のとき true。
 * 呼び出し側は true のとき contentFit='cover' + contentPosition='top' で大きく見せる
 * (false=全体表示でも cover は box比=画像比なので実質クロップ無し)。
 */
export function mediaIsCropped(aspect: number): boolean {
  const ar = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  return ar < MEDIA_MIN_ASPECT;
}

/**
 * 単一画像 box のスタイル。aspect = width/height。
 * ★ 「カード幅いっぱい (謎の余白なし) + できるだけ写真全体を大きく」を基本にする:
 *     width  = containerW            … 常に幅いっぱい → 左右の余白が出ない
 *     height = containerW / 比        … 画像比そのまま = box比=画像比 → 灰色帯も出ず全体表示
 *   唯一、極端な縦長 (aspect < 9:16 = 縦コラージュ/超縦長ポスター) だけは高さ爆発を防ぐため
 *   9:16 で頭打ちにし、cover(上端) で「中途半端な細box」にせず大きく見せる (タップで全体)。
 *   これで「謎の余白(細box)」「灰色帯」「異常に細い/小さい」を同時に解消する。
 *   明示ピクセル数値なので FlashList recycled cell の高さ0潰れも起きない。
 *  containerW 不明時のみ従来の比率方式にフォールバック (保険の minHeight 付き)。
 *  画面回転/リサイズ時は呼び出し側が useWindowDimensions で再 render → 寸法が追従する。
 */
export function mediaItemAspect(aspect: number, containerW?: number): ViewStyle {
  const ar = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  const cw = containerW && containerW > 0 && Number.isFinite(containerW) ? containerW : 0;
  if (!cw) {
    // フォールバック (containerW 不明): 比率方式 + 0潰れ保険。通常経路では使われない。
    return { width: '100%', aspectRatio: ar, minHeight: 120 };
  }
  const effAr = Math.max(ar, MEDIA_MIN_ASPECT); // 超縦長だけ 9:16 で頭打ち
  const w = Math.max(1, Math.round(cw));
  const h = Math.max(1, Math.round(w / effAr));
  return { width: w, height: h };
}
