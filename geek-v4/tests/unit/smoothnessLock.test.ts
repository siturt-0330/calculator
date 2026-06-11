// ============================================================
// smoothness lock — 「滑らかさ・快適さ」を支える最適化が将来の変更で
// 静かに退行しないことを CI で保証するロックテスト。
// ------------------------------------------------------------
// introSplashLock.test.ts と同じ「固定値ロック」方針:
//   ソースから重要な最適化プロップ/設定を読み、弱められていないかを assert する。
//   ここが落ちたら「滑らかさを壊す変更」が入ったということ。意図的に値を変える時は
//   実機で blank率/スクロール追従/INP を計測してからこの期待値も更新すること。
//
// 守っている不変条件 (どれも外すとカクつき/白チラつき/もっさり遷移が再発する):
//   1. feed/community の FlashList overscan (estimatedItemSize / drawDistance) が痩せていない
//   2. feed/community の慣性スクロールが decelerationRate="fast"
//   3. root Stack と Tabs で裏画面を凍結する freezeOnBlur が有効 (前面にフレーム予算を回す)
//   4. AnonPostCard が memo 化 (スクロール中に全カードが再レンダしない)
//
// 背景研究: Geek/ディープリサーチ/UI の滑らかさ — スクロール追従と画面遷移.md
// ============================================================

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// `prop={123}` 形式の数値プロップを抽出 (見つからなければ null)。
function numProp(src: string, prop: string): number | null {
  const m = src.match(new RegExp(prop + '=\\{\\s*(\\d+)\\s*\\}'));
  return m && m[1] ? parseInt(m[1], 10) : null;
}

const feed = read('app/(tabs)/feed.tsx');
const community = read('app/(tabs)/community/index.tsx');

// ------------------------------------------------------------
// 1 + 2. リスト/スクロールの滑らかさ
// ------------------------------------------------------------
describe('smoothness lock — リスト/スクロール (退行=白チラつき/カクつき再発)', () => {
  it('feed の FlashList overscan が痩せていない (estimatedItemSize>=500 / drawDistance>=400)', () => {
    // 過小だと fast scroll で overscan バッファが足りず blank セルが出る (§ 研究ノート)。
    expect(numProp(feed, 'estimatedItemSize')).toBeGreaterThanOrEqual(500);
    expect(numProp(feed, 'drawDistance')).toBeGreaterThanOrEqual(400);
  });

  it('community の FlashList overscan も feed と同等に保たれている', () => {
    // 同じ AnonPostCard を描くのに乖離させると community だけ blank が出る (過去の不一致バグ)。
    expect(numProp(community, 'estimatedItemSize')).toBeGreaterThanOrEqual(500);
    expect(numProp(community, 'drawDistance')).toBeGreaterThanOrEqual(400);
  });

  it('feed / community の慣性スクロールが decelerationRate="fast"', () => {
    expect(feed).toMatch(/decelerationRate="fast"/);
    expect(community).toMatch(/decelerationRate="fast"/);
  });
});

// ------------------------------------------------------------
// 3. 画面遷移/裏画面凍結
// ------------------------------------------------------------
describe('smoothness lock — 画面遷移/再レンダ抑制 (退行=もっさり遷移/裏で無駄レンダ)', () => {
  it('root Stack で裏画面を凍結する freezeOnBlur が有効', () => {
    expect(read('app/_layout.tsx')).toMatch(/freezeOnBlur:\s*true/);
  });

  it('Tabs で非フォアグラウンドのタブを凍結する freezeOnBlur が有効', () => {
    expect(read('app/(tabs)/_layout.tsx')).toMatch(/freezeOnBlur:\s*true/);
  });
});

// ------------------------------------------------------------
// 4. 再レンダ抑制 (memo)
// ------------------------------------------------------------
describe('smoothness lock — カードの memo 化 (退行=スクロール中に全カード再レンダ)', () => {
  it('AnonPostCard が memo 化されている', () => {
    // feed の全 post で大量 mount されるため、ここが memo を外れると 60FPS が即死する。
    expect(read('components/feed/AnonPostCard.tsx')).toMatch(/memo\(\s*AnonPostCardInner/);
  });
});
