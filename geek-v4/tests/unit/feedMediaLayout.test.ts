// 単一画像 box レイアウトの回帰テスト。
// 不具合(謎の余白/灰色帯/異常に細い/高さ0潰れ)が二度と出ないよう、純関数の不変条件を固定する。
import {
  mediaItemAspect,
  mediaContainerWidth,
  mediaIsCropped,
  MEDIA_MIN_ASPECT,
} from '../../components/feed/feedMediaLayout';

describe('mediaContainerWidth', () => {
  it('card 内幅 = min(winW,720) - 32', () => {
    expect(mediaContainerWidth(390)).toBe(358);
    expect(mediaContainerWidth(1200)).toBe(688); // maxWidth 720 で頭打ち
    expect(mediaContainerWidth(0)).toBe(688); // 異常値は 720 扱い
  });
});

describe('mediaIsCropped', () => {
  it('9:16 より縦長だけ crop 対象', () => {
    expect(mediaIsCropped(0.8)).toBe(false); // 4:5
    expect(mediaIsCropped(0.75)).toBe(false); // 3:4
    expect(mediaIsCropped(MEDIA_MIN_ASPECT)).toBe(false); // 9:16 ちょうどは全体表示
    expect(mediaIsCropped(0.4)).toBe(true); // 縦コラージュ等 = crop
    expect(mediaIsCropped(1.5)).toBe(false); // 横長
  });
});

describe('mediaItemAspect (全幅・大きく)', () => {
  const CW = 358;
  const aspects = [0.4, 0.5625, 0.667, 0.75, 0.8, 1.0, 1.333, 1.71, 2.67];

  for (const ar of aspects) {
    it(`aspect=${ar}: 幅いっぱい(余白なし) / box比=画像比(crop時は9:16) / 0潰れ無し`, () => {
      const s = mediaItemAspect(ar, CW) as { width: number; height: number };
      expect(s.width).toBe(CW); // 常に幅いっぱい = 謎の余白なし
      expect(s.height).toBeGreaterThanOrEqual(1); // 0潰れ無し
      // crop されない (ar>=9:16) なら box比=画像比、crop されるなら 9:16 で頭打ち
      const effAr = Math.max(ar, MEDIA_MIN_ASPECT);
      expect(Math.abs(s.height - s.width / effAr)).toBeLessThanOrEqual(0.6);
    });
  }

  it('普通の縦長(4:5)は全幅で全体表示 (height = 幅/比)', () => {
    const s = mediaItemAspect(0.8, 358) as { width: number; height: number };
    expect(s.width).toBe(358);
    expect(s.height).toBe(Math.round(358 / 0.8)); // 448
  });

  it('超縦長(0.4)は 9:16 で頭打ち (それ以上は縦に伸びない)', () => {
    const s = mediaItemAspect(0.4, 358) as { width: number; height: number };
    expect(s.width).toBe(358);
    expect(s.height).toBe(Math.round(358 / MEDIA_MIN_ASPECT)); // 636
  });

  it('横長は全幅で自然に低くなる', () => {
    const s = mediaItemAspect(2.0, 358) as { width: number; height: number };
    expect(s.width).toBe(358);
    expect(s.height).toBe(179); // 358 / 2.0
  });

  it('不正な aspect は 1 (正方) 扱い', () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      const s = mediaItemAspect(bad as number, 358) as { width: number; height: number };
      expect(s.width).toBe(358);
      expect(s.height).toBe(358);
    }
  });

  it('containerW 未指定はフォールバック (比率方式 + 0潰れ保険)', () => {
    const s = mediaItemAspect(1.5) as { width: string; aspectRatio: number; minHeight: number };
    expect(s.width).toBe('100%');
    expect(s.aspectRatio).toBe(1.5);
    expect(s.minHeight).toBeGreaterThan(0);
  });
});
