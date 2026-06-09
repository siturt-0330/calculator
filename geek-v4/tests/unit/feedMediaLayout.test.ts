// 単一画像 box レイアウトの回帰テスト。
// 不具合(縦に大きすぎ/謎の余白/灰色帯/真ん中だけ/高さ0潰れ)が二度と出ないよう不変条件を固定。
import {
  mediaItemAspect,
  mediaContainerWidth,
  mediaIsCropped,
} from '../../components/feed/feedMediaLayout';

describe('mediaContainerWidth', () => {
  it('card 内幅 = min(winW,720) - 32', () => {
    expect(mediaContainerWidth(390)).toBe(358);
    expect(mediaContainerWidth(1200)).toBe(688); // maxWidth 720 で頭打ち
    expect(mediaContainerWidth(0)).toBe(688); // 異常値は 720 扱い
  });
});

describe('mediaIsCropped', () => {
  const CW = 358;
  const MAXH = 320;
  it('全幅の自然高さ(幅/比)が maxH を超える縦長だけ crop', () => {
    expect(mediaIsCropped(0.5, CW, MAXH)).toBe(true); // 716 > 320
    expect(mediaIsCropped(0.8, CW, MAXH)).toBe(true); // 447 > 320 (4:5 も頭打ち)
    expect(mediaIsCropped(1.0, CW, MAXH)).toBe(true); // 358 > 320
    expect(mediaIsCropped(1.71, CW, MAXH)).toBe(false); // 209 < 320 = 全体表示
  });
  it('maxH 無指定なら crop しない', () => {
    expect(mediaIsCropped(0.4, CW)).toBe(false);
  });
});

describe('mediaItemAspect (全幅 + 高さ上限)', () => {
  const CW = 358;
  const MAXH = 320;

  for (const ar of [0.4, 0.5625, 0.667, 0.75, 0.8, 1.0, 1.333, 1.71, 2.67]) {
    it(`aspect=${ar}: 幅いっぱい(余白なし) / 高さ<=maxH / 0潰れ無し`, () => {
      const s = mediaItemAspect(ar, CW, MAXH) as { width: number; height: number };
      expect(s.width).toBe(CW); // 常に幅いっぱい = 謎の余白なし
      expect(s.height).toBeGreaterThanOrEqual(1); // 0潰れ無し
      expect(s.height).toBeLessThanOrEqual(MAXH); // 縦に大きすぎない (頭打ち)
    });
  }

  it('短い画像(横長)は自然高さ = 写真全体 (crop 無し)', () => {
    const s = mediaItemAspect(1.71, 358, 320) as { width: number; height: number };
    expect(s.width).toBe(358);
    expect(s.height).toBe(Math.round(358 / 1.71)); // 209
  });

  it('縦長は maxH で頭打ち (cover+上端で見せる)', () => {
    const s = mediaItemAspect(0.5, 358, 320) as { width: number; height: number };
    expect(s.width).toBe(358);
    expect(s.height).toBe(320);
  });

  it('maxH 無指定は自然高さ (頭打ちなし)', () => {
    const s = mediaItemAspect(0.5, 358) as { width: number; height: number };
    expect(s.height).toBe(Math.round(358 / 0.5)); // 716
  });

  it('不正な aspect は 1 (正方) 扱い → maxH で頭打ち', () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      const s = mediaItemAspect(bad as number, 358, 320) as { width: number; height: number };
      expect(s.width).toBe(358);
      expect(s.height).toBe(320); // 正方 358 > 320 → 頭打ち
    }
  });

  it('containerW 未指定はフォールバック (比率方式 + 0潰れ保険)', () => {
    const s = mediaItemAspect(1.5) as { width: string; aspectRatio: number; minHeight: number };
    expect(s.width).toBe('100%');
    expect(s.aspectRatio).toBe(1.5);
    expect(s.minHeight).toBeGreaterThan(0);
  });
});
