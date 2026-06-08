// ============================================================
// tests/unit/photoEditorRender.test.ts
// ------------------------------------------------------------
// 写真エディタの純粋な座標計算 (contain-fit / screen<->image / 当たり判定) を検証。
// canvas 描画部 (DOM) はテスト対象外 (web 実行時のみ)。
// ============================================================

import {
  containFit,
  identityFit,
  screenToImage,
  imageToScreen,
  objBounds,
  hitTestObject,
  estimateTextWidth,
  type EditorOp,
} from '../../lib/photoEditorRender';

describe('containFit', () => {
  it('横長画像を正方形 boxに → 幅fit・上下センタリング', () => {
    const f = containFit(400, 400, 2000, 1000);
    expect(f.scale).toBeCloseTo(0.2, 6);
    expect(f.drawW).toBeCloseTo(400, 6);
    expect(f.drawH).toBeCloseTo(200, 6);
    expect(f.offsetX).toBeCloseTo(0, 6);
    expect(f.offsetY).toBeCloseTo(100, 6);
  });

  it('縦長画像を正方形 boxに → 高さfit・左右センタリング', () => {
    const f = containFit(400, 400, 1000, 2000);
    expect(f.scale).toBeCloseTo(0.2, 6);
    expect(f.drawW).toBeCloseTo(200, 6);
    expect(f.drawH).toBeCloseTo(400, 6);
    expect(f.offsetX).toBeCloseTo(100, 6);
    expect(f.offsetY).toBeCloseTo(0, 6);
  });

  it('不正値は安全にフォールバック', () => {
    const f = containFit(0, 0, 100, 100);
    expect(f.scale).toBe(1);
  });
});

describe('screenToImage / imageToScreen', () => {
  const fit = containFit(400, 400, 2000, 1000); // scale 0.2, offsetY 100

  it('画面端 → 画像座標', () => {
    expect(screenToImage(0, 100, fit)).toEqual({ x: 0, y: 0 });
    const p = screenToImage(400, 300, fit);
    expect(p.x).toBeCloseTo(2000, 4);
    expect(p.y).toBeCloseTo(1000, 4);
  });

  it('round-trip で元に戻る', () => {
    for (const [sx, sy] of [[10, 120], [200, 250], [399, 299]] as const) {
      const img = screenToImage(sx, sy, fit);
      const back = imageToScreen(img.x, img.y, fit);
      expect(back.x).toBeCloseTo(sx, 4);
      expect(back.y).toBeCloseTo(sy, 4);
    }
  });

  it('identityFit は等倍 (出力用)', () => {
    const f = identityFit(1234, 567);
    expect(f.scale).toBe(1);
    expect(screenToImage(50, 60, f)).toEqual({ x: 50, y: 60 });
  });
});

describe('objBounds / hitTestObject', () => {
  const stamp: EditorOp = { type: 'stamp', emoji: '😀', x: 100, y: 100, size: 40 };
  const text: EditorOp = { type: 'text', text: 'あ', color: '#fff', x: 300, y: 200, size: 50 };
  const stroke: EditorOp = { type: 'stroke', color: '#fff', width: 5, points: [{ x: 0, y: 0 }] };

  it('stamp の bounds は中心基準の正方形', () => {
    expect(objBounds(stamp as never)).toEqual({ x: 80, y: 80, w: 40, h: 40 });
  });

  it('stamp 内/外の判定', () => {
    expect(hitTestObject([stamp], 100, 100)).toBe(0);
    expect(hitTestObject([stamp], 200, 200)).toBe(-1);
  });

  it('stroke は当たり判定対象外 (-1)', () => {
    expect(hitTestObject([stroke], 0, 0)).toBe(-1);
  });

  it('重なりは最前面 (配列後方) を優先', () => {
    const a: EditorOp = { type: 'stamp', emoji: 'A', x: 100, y: 100, size: 60 };
    const b: EditorOp = { type: 'stamp', emoji: 'B', x: 110, y: 110, size: 60 };
    // (105,105) は両方に含まれる → 後勝ち = index 1
    expect(hitTestObject([a, b], 105, 105)).toBe(1);
  });

  it('全角は半角より広い幅 (日本語 hit-box 修正)', () => {
    expect(estimateTextWidth('あいう', 50)).toBeCloseTo(150, 4); // 3 全角 * 1.0em
    expect(estimateTextWidth('abc', 50)).toBeCloseTo(84, 4); // 3 半角 * 0.56em
    expect(estimateTextWidth('', 50)).toBe(0);
    // objBounds も全角で広くなる
    const jp: EditorOp = { type: 'text', text: 'あいうえお', color: '#fff', x: 0, y: 0, size: 40 };
    expect(objBounds(jp as Extract<EditorOp, { type: 'text' }>).w).toBeCloseTo(200, 4);
  });

  it('text のヒット + pad 拡張', () => {
    // text 中心(300,200) size50 → 高さ65, 幅は max(50, 1*50*0.62=31)=50 → bounds x275..325,y167.5..232.5
    expect(hitTestObject([text], 300, 200)).toBe(0);
    expect(hitTestObject([text], 330, 200)).toBe(-1);
    expect(hitTestObject([text], 330, 200, 10)).toBe(0); // pad で拡張
  });
});
