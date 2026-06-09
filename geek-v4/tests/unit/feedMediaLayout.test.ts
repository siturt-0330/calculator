// 単一画像 box レイアウトの回帰テスト。
// 不具合(灰色帯/巨大表示/高さ0潰れ)が二度と出ないよう、純関数の不変条件を固定する。
import { mediaItemAspect, mediaContainerWidth } from '../../components/feed/feedMediaLayout';

describe('mediaContainerWidth', () => {
  it('card 内幅 = min(winW,720) - 32', () => {
    expect(mediaContainerWidth(390)).toBe(358);
    expect(mediaContainerWidth(1200)).toBe(688); // maxWidth 720 で頭打ち
    expect(mediaContainerWidth(0)).toBe(688); // 異常値は 720 扱い
  });
});

describe('mediaItemAspect (明示px box)', () => {
  const CW = 358;
  const MAXH = 340;
  const aspects = [0.4, 0.5625, 0.75, 0.8, 1.0, 1.333, 1.71, 1.91, 2.67, 4.0];

  for (const ar of aspects) {
    it(`aspect=${ar}: box比=画像比 / 高さ<=maxH / 幅<=containerW / 0潰れ無し`, () => {
      const s = mediaItemAspect(ar, { maxH: MAXH, containerW: CW }) as { width: number; height: number };
      expect(typeof s.width).toBe('number');
      expect(typeof s.height).toBe('number');
      // 灰色帯ゼロ: contain の余白がサブピクセル (高さが理想 w/ar と <=0.5px しか違わない)。
      // ※ アスペクト差で測ると極端比(例 4:1)で 1px 丸めが拡大されるため、px 差で評価する。
      expect(Math.abs(s.height - s.width / ar)).toBeLessThanOrEqual(0.6);
      // 巨大表示なし: 高さ上限・幅上限の両方を超えない (1px の丸め許容)
      expect(s.height).toBeLessThanOrEqual(MAXH + 1);
      expect(s.width).toBeLessThanOrEqual(CW + 1);
      // 0潰れ無し: 明示数値で正の寸法
      expect(s.height).toBeGreaterThanOrEqual(1);
      expect(s.width).toBeGreaterThanOrEqual(1);
    });
  }

  it('縦長は maxH で頭打ち (中央寄せ)', () => {
    const s = mediaItemAspect(0.5, { maxH: 340, containerW: 358 }) as { width: number; height: number; alignSelf: string };
    expect(s.height).toBe(340);
    expect(s.width).toBe(170); // 340 * 0.5
    expect(s.alignSelf).toBe('center');
  });

  it('横長は containerW 幅一杯 (高さは比で自然に低く)', () => {
    const s = mediaItemAspect(2.0, { maxH: 340, containerW: 358 }) as { width: number; height: number };
    expect(s.width).toBe(358);
    expect(s.height).toBe(179); // 358 / 2.0
  });

  it('正方は maxH で頭打ち (全幅にしない)', () => {
    const s = mediaItemAspect(1.0, { maxH: 340, containerW: 358 }) as { width: number; height: number };
    expect(s.width).toBe(340);
    expect(s.height).toBe(340);
  });

  it('不正な aspect は 1 (正方) 扱い', () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      const s = mediaItemAspect(bad as number, { maxH: 340, containerW: 358 }) as { width: number; height: number };
      expect(s.width / s.height).toBeCloseTo(1, 5);
    }
  });

  it('containerW 未指定はフォールバック (比率方式 + 0潰れ保険)', () => {
    const s = mediaItemAspect(1.5) as { width: string; aspectRatio: number; minHeight: number };
    expect(s.width).toBe('100%');
    expect(s.aspectRatio).toBe(1.5);
    expect(s.minHeight).toBeGreaterThan(0);
  });
});
