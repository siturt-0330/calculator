// 単一画像 box レイアウトの回帰テスト。
// 「全体表示 (box が画像アスペクトと一致) + 0潰れ無し」の不変条件を固定。
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
  it('常に false (contain 全体表示保証によりクロップ発生なし)', () => {
    expect(mediaIsCropped(0.5, 358, 320)).toBe(false);
    expect(mediaIsCropped(0.8, 358, 320)).toBe(false);
    expect(mediaIsCropped(1.0, 358, 320)).toBe(false);
    expect(mediaIsCropped(1.71, 358, 320)).toBe(false);
    expect(mediaIsCropped(0.4, 358)).toBe(false);
  });
});

describe('mediaItemAspect (box が画像アスペクトと一致 + 高さ上限)', () => {
  const CW = 358;
  const MAXH = 320;

  it('box のアスペクト比は画像アスペクト比と一致 (灰色帯なし保証)', () => {
    for (const ar of [0.4, 0.5, 0.5625, 0.667, 0.75, 1.0, 1.333, 1.71]) {
      const s = mediaItemAspect(ar, CW, MAXH) as { width: number; height: number };
      // box aspect ≈ image aspect (相対誤差 5% + 0.05 の余裕)
      expect(Math.abs(s.width / s.height - ar)).toBeLessThan(ar * 0.05 + 0.05);
    }
  });

  it('高さは 0 より大きく maxH 以下', () => {
    for (const ar of [0.4, 0.5625, 0.667, 0.75, 0.8, 1.0, 1.333, 1.71, 2.67]) {
      const s = mediaItemAspect(ar, CW, MAXH) as { width: number; height: number };
      expect(s.height).toBeGreaterThanOrEqual(1);
      expect(s.height).toBeLessThanOrEqual(MAXH);
    }
  });

  it('横長画像 (自然高さ <= maxH): カード幅 × 自然高さ', () => {
    // ar=1.71: naturalH=358/1.71≈209 ≤ 320 → カード幅いっぱい
    const s = mediaItemAspect(1.71, CW, MAXH) as { width: number; height: number };
    expect(s.width).toBe(CW);
    expect(s.height).toBe(Math.round(CW / 1.71)); // 209
  });

  it('縦長画像 (自然高さ > maxH): 高さを cap、幅を比例縮小', () => {
    // ar=0.5: naturalH=358/0.5=716 > 320 → h=320, w=320*0.5=160
    const s = mediaItemAspect(0.5, CW, MAXH) as { width: number; height: number };
    expect(s.height).toBe(MAXH);
    expect(s.width).toBe(Math.round(MAXH * 0.5)); // 160
  });

  it('maxH 無指定は自然高さ (頭打ちなし)', () => {
    const s = mediaItemAspect(1.5, CW) as { width: number; height: number };
    expect(s.width).toBe(CW);
    expect(s.height).toBe(Math.round(CW / 1.5)); // 239
  });

  it('不正な aspect は 1 (正方) 扱い → 高さ cap に収まる', () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      const s = mediaItemAspect(bad as number, CW, MAXH) as { width: number; height: number };
      // 正方(ar=1): naturalH=358 > 320 → h=320, w=320
      expect(s.height).toBe(MAXH);
      expect(s.width).toBe(Math.round(MAXH * 1));
    }
  });

  it('containerW 未指定はフォールバック (比率方式 + 0潰れ保険)', () => {
    const s = mediaItemAspect(1.5) as { width: string; aspectRatio: number; minHeight: number };
    expect(s.width).toBe('100%');
    expect(s.aspectRatio).toBe(1.5);
    expect(s.minHeight).toBeGreaterThan(0);
  });
});
