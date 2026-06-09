// ============================================================
// components/feed/feedMediaLayout.ts
// ============================================================
// 単一画像の表示 box スタイルを feed / 投稿詳細 / マイページ で共有する小ユーティリティ。
// 「写真全体を見せる (contain) + コンパクト + 縦写真は中央寄せの細box (左右レターボックス
// 無し)」を 1 箇所に集約し、画面ごとにブレないようにする。
// ============================================================

import type { ViewStyle } from 'react-native';

/**
 * 単一画像 box のスタイル。aspect = width/height。
 * ★ box は常に「画像の真のアスペクト」にする → contentFit='contain' が box を隙間なく
 *   埋める = 左右/上下のレターボックス(灰色帯)が一切出ない。写真は全体表示。
 *  - 縦長 (aspect<1): 高さを portraitMaxH で固定し 幅=高さ×比 の中央寄せ box (画面占有を抑制)。
 *  - 横長/正方: 全幅・比で高さ決定 (横長は自然に低くなる)。
 *  クランプしない理由: box≠画像比 になった瞬間に contain で灰色帯が出るため (今回の不具合)。
 *  極端比はそのぶん細く/低くなるが「灰色の箱」より自然で、タップで全画面確認できる。
 */
export function mediaItemAspect(aspect: number, portraitMaxH?: number): ViewStyle {
  const ar = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  if (ar < 1 && portraitMaxH && portraitMaxH > 0) {
    // 縦長: 幅を「高さ上限×比」で固定し、高さは aspectRatio から算出 (height は明示しない)。
    // こうすると maxWidth:'100%' が効いて幅が縮んでも height が比に追従して再計算されるため、
    // box の比は常に画像比と一致 → contentFit='contain' が隙間なく埋まる = 灰色帯ゼロ。
    // (height を明示固定すると幅クランプ時に比が壊れて灰色帯が出る = 旧不具合の原因)
    return { width: portraitMaxH * ar, aspectRatio: ar, maxWidth: '100%', alignSelf: 'center' };
  }
  return { width: '100%', aspectRatio: ar };
}
