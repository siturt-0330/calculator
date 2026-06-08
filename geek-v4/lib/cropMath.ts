// ============================================================
// lib/cropMath.ts — クロッパーの座標計算 (pure / テスト可能)
// ============================================================
// `app/image-cropper.tsx` の handleNext に inline していた crop 矩形計算を
// 純関数として切り出したもの。screen 上の transform (scale/translate) と
// crop フレーム (icon=正方形 / 写真=任意アスペクト) から、回転適用後の
// ソース画像座標系での crop 矩形を求める。
//
// なぜ切り出すか:
//   - この座標計算は過去に何度も事故っている (非正方形化 → 引き伸ばし等)。
//     component に埋まっていると Jest で検証できず回帰が捕まらない。
//   - icon (正方形/円) と 投稿写真 (矩形) で同じ数学を共有したい。
//     `square: true` で従来の icon 挙動を 1px も変えずに再現する。
//
// 重要な性質 (cover-fit の前提):
//   fitW/fitH は「フレームを cover する表示寸法」。cover はソース→表示の
//   倍率が縦横で一致する (uniform) ため、srcPerScreenX === srcPerScreenY。
//   よって矩形フレームでも raw 矩形のアスペクト = フレームのアスペクトが保たれる。
// ============================================================

export type Rotation90 = 0 | 90 | 180 | 270;

export interface CropRectInput {
  /** 画面 (gesture が報告する座標系と同じ CSS px) の寸法 */
  screenW: number;
  screenH: number;
  /** crop フレームの画面上の寸法。icon は frameW === frameH (= 直径)。 */
  frameW: number;
  frameH: number;
  /** 現在の pinch scale (1 = cover) */
  scale: number;
  /** 現在の pan (画面 px) */
  translateX: number;
  translateY: number;
  /** 表示中の画像の素の寸法 (scale 適用前 / cover-fit 済み) */
  fitW: number;
  fitH: number;
  /** ソース画像の自然寸法 (回転適用前) */
  imageW: number;
  imageH: number;
  rotation: Rotation90;
  /**
   * icon 用: 出力を必ず正方形にする (= 従来挙動を完全再現)。
   * 省略/false の場合はフレームのアスペクトを保った矩形 crop。
   */
  square?: boolean;
}

export interface CropRect {
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/**
 * 画面 transform → 回転後ソース座標系の crop 矩形。
 * 返り値は ImageManipulator / canvas に渡せる origin + size (回転は別途先に適用する前提)。
 */
export function computeCropRect(input: CropRectInput): CropRect {
  const {
    screenW,
    screenH,
    frameW,
    frameH,
    scale,
    translateX,
    translateY,
    fitW,
    fitH,
    imageW,
    imageH,
    rotation,
  } = input;

  // 画面上の描画サイズ (scale 後)
  const renderedW = fitW * scale;
  const renderedH = fitH * scale;

  // 画面中央が画像 center。そこから translate した位置に画像左上が来る。
  const cx = screenW / 2 + translateX;
  const cy = screenH / 2 + translateY;
  const imgLeftOnScreen = cx - renderedW / 2;
  const imgTopOnScreen = cy - renderedH / 2;

  // crop フレームの画面上 bounding rect (中央配置)
  const frameLeftOnScreen = (screenW - frameW) / 2;
  const frameTopOnScreen = (screenH - frameH) / 2;

  // 画像 local 座標 (画面 px) での crop offset
  const offsetXOnScreen = frameLeftOnScreen - imgLeftOnScreen;
  const offsetYOnScreen = frameTopOnScreen - imgTopOnScreen;

  // 回転適用後の自然サイズ (manipulator/canvas が rotate を先に処理する前提)
  const swap = rotation === 90 || rotation === 270;
  const rotatedNatW = swap ? imageH : imageW;
  const rotatedNatH = swap ? imageW : imageH;

  // screen px → source px の倍率 (cover なので縦横一致するが、安全のため個別計算)
  const srcPerScreenX = renderedW > 0 ? rotatedNatW / renderedW : 0;
  const srcPerScreenY = renderedH > 0 ? rotatedNatH / renderedH : 0;

  // raw crop 矩形 (回転後座標系)
  const rawCropX = offsetXOnScreen * srcPerScreenX;
  const rawCropY = offsetYOnScreen * srcPerScreenY;
  const rawCropW = frameW * srcPerScreenX;
  const rawCropH = frameH * srcPerScreenY;

  const rawCenterX = rawCropX + rawCropW / 2;
  const rawCenterY = rawCropY + rawCropH / 2;

  if (input.square) {
    // ---- icon 用 (従来挙動を完全再現) ----
    // raw の中心を保ったまま、画像内に収まる最大正方形へ補正。
    const side = Math.max(16, Math.min(rawCropW, rotatedNatW, rotatedNatH));
    const cropX = clamp(rawCenterX - side / 2, 0, Math.max(0, rotatedNatW - side));
    const cropY = clamp(rawCenterY - side / 2, 0, Math.max(0, rotatedNatH - side));
    return { cropX, cropY, cropW: side, cropH: side };
  }

  // ---- 矩形 (投稿写真) ----
  // フレームのアスペクトを保ったまま画像内に収める。MIN_SCALE=cover + pan クランプが
  // 効いていれば raw は既に画像内だが、安全網として shrink-to-fit する。
  const shrink = Math.min(
    1,
    rawCropW > 0 ? rotatedNatW / rawCropW : 1,
    rawCropH > 0 ? rotatedNatH / rawCropH : 1,
  );
  const cropW = Math.max(16, rawCropW * shrink);
  const cropH = Math.max(16, rawCropH * shrink);
  const cropX = clamp(rawCenterX - cropW / 2, 0, Math.max(0, rotatedNatW - cropW));
  const cropY = clamp(rawCenterY - cropH / 2, 0, Math.max(0, rotatedNatH - cropH));
  return { cropX, cropY, cropW, cropH };
}

// ============================================================
// cover-fit の表示寸法 — フレーム (frameW×frameH) を覆う最小サイズ
// ------------------------------------------------------------
// icon は frameW === frameH (正方形フレーム)。写真は任意アスペクト。
// rotation 90/270 のときは画像の幅高が入れ替わる前提で fit する。
// ============================================================
export function computeFitDims(args: {
  imageW: number;
  imageH: number;
  rotation: Rotation90;
  frameW: number;
  frameH: number;
}): { fitW: number; fitH: number } {
  const { imageW, imageH, rotation, frameW, frameH } = args;
  const swap = rotation === 90 || rotation === 270;
  const natW = swap ? imageH : imageW;
  const natH = swap ? imageW : imageH;
  const arImg = natW / natH;
  const arFrame = frameW / frameH;
  let fitW: number;
  let fitH: number;
  if (arImg >= arFrame) {
    // 画像の方が横長 → 高さをフレームに合わせて幅をあふれさせる
    fitH = frameH;
    fitW = frameH * arImg;
  } else {
    fitW = frameW;
    fitH = frameW / arImg;
  }
  return { fitW, fitH };
}

// ============================================================
// 表示用ボックス寸法 — 画面の <Image> (回転 transform 前) に与える width/height
// ------------------------------------------------------------
// ★ WYSIWYG バグ修正 (rotation 90/270): 「枠に映っている領域」と「保存される領域」を一致させる。
//
// 画面の <Image> は *回転前の元画像* を resizeMode='cover' で描画し、その後 CSS/reanimated の
// rotate transform で box ごと回す。cover は box のアスペクトへ画像をクリップする
// (web では background-size:cover が rotate より先に効く) ため、box のアスペクトが
// 元画像アスペクトと食い違うと「回転前に中身が切り取られる」→ 表示が出力とズレる。
//
// computeFitDims は *回転後画像* をフレームに cover した footprint (fitW,fitH) を返すので、
// rotation 90/270 では box にそのまま渡すと box AR = 1/元AR となりクリップが起きる。
// そこで box には常に *元画像アスペクト* を持たせる = 90/270 では fitW/fitH を入れ替える。
//
// すると:
//   - box AR === 元画像 AR → cover は回転前にクリップしない (フル画像が見える)
//   - box を 90° 回した footprint = (boxH,boxW) = (fitW,fitH) = 回転後画像の cover footprint
//     → computeCropRect / 出力パイプライン (rotate-then-crop) と画面 footprint が完全一致する。
//   - pan/pinch クランプ (fitW,fitH 基準) も実 footprint に一致する。
// rotation 0/180 は入れ替え不要 (box=footprint, 既に元画像 AR)。
// ============================================================
export function computeDisplayBoxDims(args: {
  fitW: number;
  fitH: number;
  rotation: Rotation90;
}): { boxW: number; boxH: number } {
  const swap = args.rotation === 90 || args.rotation === 270;
  return {
    boxW: swap ? args.fitH : args.fitW,
    boxH: swap ? args.fitW : args.fitH,
  };
}

// ============================================================
// 出力寸法 — crop 矩形 (source px) を maxEdge に収めつつアスペクト維持
// ------------------------------------------------------------
// icon は呼び出し側が 512 正方形を使うのでこの関数は使わない。
// 写真は元の crop 解像度を活かしつつ巨大画像を抑える。
// ============================================================
export function computeOutputDims(cropW: number, cropH: number, maxEdge: number): { outW: number; outH: number } {
  const longest = Math.max(cropW, cropH);
  const k = longest > maxEdge ? maxEdge / longest : 1;
  return {
    outW: Math.max(1, Math.round(cropW * k)),
    outH: Math.max(1, Math.round(cropH * k)),
  };
}
