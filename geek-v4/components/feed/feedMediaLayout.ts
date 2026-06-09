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
 * 単一画像 box のスタイル。aspect = width/height。
 * ★ box を「明示ピクセル幅 × 高さ」で返す (CSS aspectRatio に頼らない)。
 *     w = min(containerW, maxH × 比) / h = w / 比
 *   → box比 = 画像比 を厳守しつつ、高さ上限(maxH)と幅上限(containerW)の両方でクランプ。
 *   これで 3 つの不具合を同時に根治する:
 *     1. 灰色帯(レターボックス)ゼロ … box比=画像比 なので contain が隙間なく埋まる。
 *        縦長(左右帯)も 横長/パノラマ(上下帯)も出ない。
 *     2. 巨大表示なし … 縦長/正方は maxH で頭打ち = 中央寄せの細box。横長は幅上限で自然に低くなる。
 *     3. FlashList recycled cell の「高さ0潰れ」なし … 明示数値なので aspectRatio の
 *        レイアウト解決待ち (= 旧 minHeight:200 が保険していた現象) が原理的に起きない。
 *  containerW 不明時のみ従来の比率方式にフォールバック (保険の minHeight 付き)。
 *  画面回転/リサイズ時は呼び出し側が useWindowDimensions で再 render → 寸法が追従する。
 */
export function mediaItemAspect(
  aspect: number,
  opts?: { maxH?: number; containerW?: number },
): ViewStyle {
  const ar = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  const containerW =
    opts?.containerW && opts.containerW > 0 && Number.isFinite(opts.containerW) ? opts.containerW : 0;
  if (!containerW) {
    // フォールバック (containerW 不明): 比率方式 + 0潰れ保険。通常経路では使われない。
    return { width: '100%', aspectRatio: ar, minHeight: 120 };
  }
  const maxH = opts?.maxH && opts.maxH > 0 && Number.isFinite(opts.maxH) ? opts.maxH : 0;
  const w = maxH ? Math.min(containerW, maxH * ar) : containerW;
  const wR = Math.max(1, Math.round(w));
  const hR = Math.max(1, Math.round(wR / ar));
  return { width: wR, height: hR, alignSelf: 'center' };
}
