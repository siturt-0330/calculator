// ============================================================
// tests/unit/cropMath.test.ts
// ------------------------------------------------------------
// クロッパー座標計算 (lib/cropMath.ts) の回帰防止テスト。
// 過去に「非正方形化 → 引き伸ばし」「回転で crop がずれる」事故があった領域。
// 画面 transform → 回転後ソース座標系の crop 矩形が、手計算と一致するか検証する。
// ============================================================

import { computeCropRect, computeFitDims, computeOutputDims, computeDisplayBoxDims } from '../../lib/cropMath';

describe('computeFitDims (cover-fit)', () => {
  it('正方形画像を正方形フレームに → フレーム寸法ぴったり', () => {
    expect(computeFitDims({ imageW: 1000, imageH: 1000, rotation: 0, frameW: 300, frameH: 300 })).toEqual({
      fitW: 300,
      fitH: 300,
    });
  });

  it('横長画像を正方形フレームに → 高さをフレームに合わせ幅があふれる', () => {
    // aspect 2:1 → fitH=300, fitW=600
    expect(computeFitDims({ imageW: 2000, imageH: 1000, rotation: 0, frameW: 300, frameH: 300 })).toEqual({
      fitW: 600,
      fitH: 300,
    });
  });

  it('縦長画像を正方形フレームに → 幅をフレームに合わせ高さがあふれる', () => {
    expect(computeFitDims({ imageW: 1000, imageH: 2000, rotation: 0, frameW: 300, frameH: 300 })).toEqual({
      fitW: 300,
      fitH: 600,
    });
  });

  it('rotation 90 で幅高が入れ替わる', () => {
    // 2000x1000 を 90 回転 → 1000x2000 扱い。正方形フレームに対し縦長になる。
    expect(computeFitDims({ imageW: 2000, imageH: 1000, rotation: 90, frameW: 300, frameH: 300 })).toEqual({
      fitW: 300,
      fitH: 600,
    });
  });
});

describe('computeCropRect — square (icon) モード', () => {
  const base = { screenW: 400, screenH: 800, frameW: 300, frameH: 300, scale: 1, translateX: 0, translateY: 0 };

  it('正方形画像・無操作 → 全体が crop される', () => {
    const r = computeCropRect({
      ...base,
      fitW: 300,
      fitH: 300,
      imageW: 1000,
      imageH: 1000,
      rotation: 0,
      square: true,
    });
    expect(r).toEqual({ cropX: 0, cropY: 0, cropW: 1000, cropH: 1000 });
  });

  it('横長画像・無操作 → 中央の正方形が crop される', () => {
    const r = computeCropRect({
      ...base,
      fitW: 600,
      fitH: 300,
      imageW: 2000,
      imageH: 1000,
      rotation: 0,
      square: true,
    });
    // 2000x1000 の中央 1000x1000 → x=500
    expect(r).toEqual({ cropX: 500, cropY: 0, cropW: 1000, cropH: 1000 });
  });

  it('縦長画像・無操作 → 中央の正方形が crop される', () => {
    const r = computeCropRect({
      ...base,
      fitW: 300,
      fitH: 600,
      imageW: 1000,
      imageH: 2000,
      rotation: 0,
      square: true,
    });
    expect(r).toEqual({ cropX: 0, cropY: 500, cropW: 1000, cropH: 1000 });
  });

  it('rotation 90: 回転後座標系で中央正方形', () => {
    const r = computeCropRect({
      ...base,
      fitW: 300,
      fitH: 600,
      imageW: 2000,
      imageH: 1000,
      rotation: 90,
      square: true,
    });
    // 回転後は 1000x2000。中央 1000x1000 → y=500
    expect(r).toEqual({ cropX: 0, cropY: 500, cropW: 1000, cropH: 1000 });
  });

  it('常に正方形 (cropW === cropH) を返す — 非正方形化バグの回帰防止', () => {
    for (const [iw, ih] of [
      [3000, 1000],
      [1000, 3000],
      [1234, 5678],
      [4032, 3024],
    ] as const) {
      const ar = iw / ih;
      const fitW = ar >= 1 ? 300 * ar : 300;
      const fitH = ar >= 1 ? 300 : 300 / ar;
      const r = computeCropRect({
        ...base,
        fitW,
        fitH,
        imageW: iw,
        imageH: ih,
        rotation: 0,
        square: true,
      });
      expect(r.cropW).toBe(r.cropH);
      // crop は必ず画像内に収まる
      expect(r.cropX).toBeGreaterThanOrEqual(0);
      expect(r.cropY).toBeGreaterThanOrEqual(0);
      expect(r.cropX + r.cropW).toBeLessThanOrEqual(iw + 0.001);
      expect(r.cropY + r.cropH).toBeLessThanOrEqual(ih + 0.001);
    }
  });
});

describe('computeCropRect — rect (写真) モード', () => {
  const base = { screenW: 400, screenH: 800, scale: 1, translateX: 0, translateY: 0 };

  it('original (フレーム = 画像アスペクト) → 全体が crop される (切り抜き無し)', () => {
    // 画像 2000x1000、フレームも 2:1 (600x300)
    const r = computeCropRect({
      ...base,
      frameW: 600,
      frameH: 300,
      fitW: 600,
      fitH: 300,
      imageW: 2000,
      imageH: 1000,
      rotation: 0,
    });
    expect(r.cropX).toBeCloseTo(0, 3);
    expect(r.cropY).toBeCloseTo(0, 3);
    expect(r.cropW).toBeCloseTo(2000, 3);
    expect(r.cropH).toBeCloseTo(1000, 3);
  });

  it('1:1 フレームを横長画像に → 中央正方形 (アスペクト維持)', () => {
    const r = computeCropRect({
      ...base,
      frameW: 300,
      frameH: 300,
      fitW: 600,
      fitH: 300,
      imageW: 2000,
      imageH: 1000,
      rotation: 0,
    });
    expect(r.cropX).toBeCloseTo(500, 3);
    expect(r.cropY).toBeCloseTo(0, 3);
    expect(r.cropW).toBeCloseTo(1000, 3);
    expect(r.cropH).toBeCloseTo(1000, 3);
  });

  it('フレームのアスペクトが crop 矩形に保たれる', () => {
    // 16:9 フレーム (480x270) を 縦長 1000x2000 画像に
    const r = computeCropRect({
      ...base,
      frameW: 480,
      frameH: 270,
      // cover: arImg=0.5 < arFrame=1.78 → fitW=frameW=480, fitH=480/0.5=960
      fitW: 480,
      fitH: 960,
      imageW: 1000,
      imageH: 2000,
      rotation: 0,
    });
    // crop のアスペクトはフレーム (16:9) に一致するはず
    expect(r.cropW / r.cropH).toBeCloseTo(480 / 270, 2);
    // 画像内に収まる
    expect(r.cropX).toBeGreaterThanOrEqual(-0.001);
    expect(r.cropX + r.cropW).toBeLessThanOrEqual(1000.001);
    expect(r.cropY + r.cropH).toBeLessThanOrEqual(2000.001);
  });

  it('ズームすると crop 範囲が狭くなる (拡大 = trim)', () => {
    const common = {
      ...base,
      frameW: 300,
      frameH: 300,
      fitW: 300,
      fitH: 300,
      imageW: 1000,
      imageH: 1000,
      rotation: 0 as const,
    };
    const noZoom = computeCropRect({ ...common, scale: 1 });
    const zoomed = computeCropRect({ ...common, scale: 2 });
    expect(zoomed.cropW).toBeLessThan(noZoom.cropW);
    // 2x ズームでおよそ半分
    expect(zoomed.cropW).toBeCloseTo(noZoom.cropW / 2, 1);
  });
});

describe('computeOutputDims', () => {
  it('maxEdge 以下はそのまま', () => {
    expect(computeOutputDims(300, 300, 512)).toEqual({ outW: 300, outH: 300 });
  });

  it('長辺を maxEdge に収めアスペクト維持', () => {
    expect(computeOutputDims(4000, 3000, 1440)).toEqual({ outW: 1440, outH: 1080 });
  });

  it('縦長も長辺基準', () => {
    expect(computeOutputDims(1000, 2000, 1000)).toEqual({ outW: 500, outH: 1000 });
  });
});

describe('computeDisplayBoxDims (WYSIWYG: 表示 box のアスペクト)', () => {
  it('rotation 0/180 は fit 寸法そのまま', () => {
    expect(computeDisplayBoxDims({ fitW: 600, fitH: 300, rotation: 0 })).toEqual({ boxW: 600, boxH: 300 });
    expect(computeDisplayBoxDims({ fitW: 600, fitH: 300, rotation: 180 })).toEqual({ boxW: 600, boxH: 300 });
  });

  it('rotation 90/270 は fitW/fitH を入れ替える (box は元画像アスペクト)', () => {
    expect(computeDisplayBoxDims({ fitW: 300, fitH: 600, rotation: 90 })).toEqual({ boxW: 600, boxH: 300 });
    expect(computeDisplayBoxDims({ fitW: 300, fitH: 600, rotation: 270 })).toEqual({ boxW: 600, boxH: 300 });
  });

  it('回転後 box の footprint が cover footprint(fit 寸法) に一致 = WYSIWYG', () => {
    // 4000x2000 (AR 2.0) を 1:1 フレーム + rotation 90
    const fit = computeFitDims({ imageW: 4000, imageH: 2000, rotation: 90, frameW: 300, frameH: 300 });
    const box = computeDisplayBoxDims({ fitW: fit.fitW, fitH: fit.fitH, rotation: 90 });
    // box AR == 元画像 AR (2.0) → cover が回転前にクリップしない
    expect(box.boxW / box.boxH).toBeCloseTo(4000 / 2000, 5);
    // box を 90° 回した footprint (boxH, boxW) == (fitW, fitH)
    expect({ w: box.boxH, h: box.boxW }).toEqual({ w: fit.fitW, h: fit.fitH });
  });
});
