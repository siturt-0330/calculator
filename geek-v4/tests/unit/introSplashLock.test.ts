// ============================================================
// introSplashLock — 「イントロを固定 (変更禁止)」を機械的に守る回帰テスト
// ============================================================
// 目的:
//   起動スプラッシュ (web の instant splash: scripts/web-postbuild.mjs が dist に注入) と
//   アプリ mount 後のイントロ (components/ui/IntroAnimation.tsx) は「継ぎ目のない起動体験」
//   のため **完全一致** の寸法・グラデ・タイミングで固定されている (CLAUDE.md §11 起動5秒黒画面 /
//   IntroAnimation.tsx の設計コメント参照)。誰かがブランドグラデや一致寸法をうっかり変えたら、
//   splash → intro → 本体 の seam (ジャンプ) が再発する。このテストはそれを CI で止める。
//
// なぜ「ソース文字列を読んで正規表現で突合」なのか (重要な前提):
//   このリポジトリの Jest は **jest-expo preset 無し**・testEnvironment=node・
//   transformIgnorePatterns=default (node_modules を一切 transform しない) で動いている。
//   そのため design/typography.ts や IntroAnimation.tsx を `import` すると、それらが
//   読み込む 'react-native' (Flow/JSX 構文) が transform されず "Cannot use import statement
//   outside a module" でスイート全体が落ちる (実測済)。
//   → ランタイム import に頼らず、3 ファイルを **テキストとして読み**、固定値を正規表現で
//     assert する。これは pure / 設定非依存で、bare node env でも確実に動く。
//
// 何を守るか (3 本立て):
//   1) design/typography.ts: GEEK_GRADIENT_CSS の stop 固定 + geekGradientFill() の
//      web/native 返り値 (background-clip:text 一式 / native フォールバック色) を pin。
//   2) GEEK_GRADIENT_CSS と web-postbuild.mjs の splash .gk-word グラデ文字列の一致を突合。
//   3) IntroAnimation.tsx の CFG 主要定数 (46 / 132 / 24 / 3 / -1 / 0.38 / 色 / timing) と
//      splash (web-postbuild.mjs) の対応値の一致を assert。
//
// ★ 値を「意図的に」変えるとき (デザイン刷新) は、3 ファイルを同時に直して、このテストの
//   定数も同じ値に更新すること。テストが落ちる = 3 ファイルのどれかだけ動いて seam が出る合図。
// ============================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const typographySrc = read('design/typography.ts');
const splashSrc = read('scripts/web-postbuild.mjs');
const introSrc = read('components/ui/IntroAnimation.tsx');

// ------------------------------------------------------------
// 固定値 (single source of truth for this test)
//   ここを変える = ブランドの起動体験を変える、という意思表示。
//   3 ファイルを直さずここだけ変えても test は別の assert で落ちる。
// ------------------------------------------------------------
const BRAND_GRADIENT = 'linear-gradient(120deg, #7C6AF7 0%, #B98CFF 48%, #E891C7 100%)';
const BAR_GRADIENT = 'linear-gradient(90deg, #7C6AF7, #E891C7)';
const BG = '#0a0a0a';
const NATIVE_LOGO = '#B98CFF';

const DIM = {
  fontSize: 46, // .gk-word font-size / CFG.FONT_SIZE
  letterSpacing: -1, // .gk-word letter-spacing:-1px / CFG.LETTER_SPACING
  fontWeight: 800, // .gk-word font-weight / CFG fontWeight '800'
  barW: 132, // .gk-bar width / CFG.BAR_W
  barH: 3, // .gk-bar height / CFG.BAR_H
  barGap: 24, // .gk-bar margin-top / CFG.BAR_GAP
  sweepPct: 38, // .gk-bar::after width:38% / CFG.SWEEP_RATIO 0.38
  pulseMs: 1600, // gk-pulse 1.6s / CFG.PULSE_MS
  sweepMs: 1150, // gk-slide 1.15s / CFG.SWEEP_MS
};

// 正規表現で使う色/数値を安全にエスケープ
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ============================================================
// 1) typography.ts — ブランドグラデと geekGradientFill() の返り値を固定
// ============================================================
describe('typography.ts — ブランドグラデ / geekGradientFill() 固定', () => {
  it('GEEK_GRADIENT_CSS が起動スプラッシュと同一の stop で固定されている', () => {
    // 紫(0%) → ラベンダー(48%) → ピンク(100%)。stop を 1 つでも動かすと落ちる。
    expect(typographySrc).toContain(`GEEK_GRADIENT_CSS =`);
    expect(typographySrc).toContain(BRAND_GRADIENT);
  });

  it('geekGradientFill() の web 分岐が background-clip:text 一式を返す', () => {
    // react-native-web で「グラデ文字」を成立させる 5 プロパティ。どれが欠けても文字が
    // 不可視 or 単色に化けるので全部 pin する。
    expect(typographySrc).toMatch(/Platform\.OS === 'web'/);
    expect(typographySrc).toMatch(/color:\s*'transparent'/);
    expect(typographySrc).toMatch(/backgroundImage:\s*GEEK_GRADIENT_CSS/);
    expect(typographySrc).toMatch(/backgroundClip:\s*'text'/);
    expect(typographySrc).toMatch(/WebkitBackgroundClip:\s*'text'/);
    expect(typographySrc).toMatch(/WebkitTextFillColor:\s*'transparent'/);
  });

  it('geekGradientFill() の native フォールバックが単色 #B98CFF', () => {
    // native(RN Text) はグラデ文字を持てないので単色。splash の中央色と揃える。
    expect(typographySrc).toMatch(new RegExp(`return\\s*\\{\\s*color:\\s*'${esc(NATIVE_LOGO)}'\\s*\\}`));
  });
});

// ============================================================
// 2) GEEK_GRADIENT_CSS ↔ splash .gk-word グラデ の一致 (突合)
// ============================================================
describe('GEEK_GRADIENT_CSS ↔ web-postbuild splash gradient 一致', () => {
  it('typography の GEEK_GRADIENT_CSS と splash .gk-word の gradient が完全一致', () => {
    // どちらも同じリテラルを含むことを確認 = 片方だけ変えたら必ず落ちる。
    expect(typographySrc).toContain(BRAND_GRADIENT);
    expect(splashSrc).toContain(BRAND_GRADIENT);
  });

  it('splash の .gk-word は紫→ラベンダー→ピンクの 3-stop グラデで塗られている', () => {
    // .gk-word ブロックに gradient + background-clip:text があること (構造の崩れ検知)。
    const word = sliceCss(splashSrc, '.gk-word');
    expect(word).toContain(BRAND_GRADIENT);
    expect(word).toMatch(/background-clip:\s*text/);
    expect(word).toMatch(/-webkit-text-fill-color:\s*transparent/);
  });

  it('進捗バーのスイープ用グラデ (gk-bar::after) も固定', () => {
    const after = sliceCss(splashSrc, '.gk-bar::after');
    expect(after).toContain(BAR_GRADIENT);
  });
});

// ============================================================
// 3) IntroAnimation CFG ↔ splash 寸法/タイミング の一致 (突合)
// ============================================================
describe('IntroAnimation の主要定数 ↔ splash 寸法/タイミング 一致', () => {
  // --- intro 側 (CFG) が固定値を持つこと -------------------------------------
  it('CFG が splash と同じ寸法 (46 / 132 / 24 / 3 / -1 / 0.38) を持つ', () => {
    expect(introSrc).toMatch(new RegExp(`FONT_SIZE:\\s*${DIM.fontSize}\\b`));
    expect(introSrc).toMatch(new RegExp(`LINE_HEIGHT:\\s*${DIM.fontSize}\\b`)); // line-height:1.0 = fontSize
    expect(introSrc).toMatch(new RegExp(`LETTER_SPACING:\\s*${DIM.letterSpacing}\\b`));
    expect(introSrc).toMatch(new RegExp(`BAR_W:\\s*${DIM.barW}\\b`));
    expect(introSrc).toMatch(new RegExp(`BAR_H:\\s*${DIM.barH}\\b`));
    expect(introSrc).toMatch(new RegExp(`BAR_GAP:\\s*${DIM.barGap}\\b`));
    expect(introSrc).toMatch(/SWEEP_RATIO:\s*0\.38\b/);
  });

  it('CFG の色 (背景 / native ロゴ) が splash と一致', () => {
    expect(introSrc).toMatch(new RegExp(`BG_COLOR:\\s*'${esc(BG)}'`));
    expect(introSrc).toMatch(new RegExp(`NATIVE_LOGO_COLOR:\\s*'${esc(NATIVE_LOGO)}'`));
  });

  it('CFG のタイミング (pulse 1600 / sweep 1150) が splash の 1.6s / 1.15s と一致', () => {
    expect(introSrc).toMatch(new RegExp(`PULSE_MS:\\s*${DIM.pulseMs}\\b`));
    expect(introSrc).toMatch(new RegExp(`SWEEP_MS:\\s*${DIM.sweepMs}\\b`));
  });

  it('intro のワードマークが fontWeight 800 / ローカル GRADIENT_CSS = ブランドグラデ', () => {
    expect(introSrc).toMatch(/fontWeight:\s*'800'/);
    expect(introSrc).toContain(BRAND_GRADIENT); // intro 内ローカル GRADIENT_CSS
    expect(introSrc).toMatch(/BAR_GRADIENT\s*=\s*\['#7C6AF7',\s*'#E891C7'\]/); // バーのグラデ端点
  });

  // --- splash 側 (CSS) が同じ固定値を持つこと --------------------------------
  it('splash .gk-word: font-size 46px / weight 800 / letter-spacing -1px / line-height 1', () => {
    const word = sliceCss(splashSrc, '.gk-word');
    expect(word).toMatch(new RegExp(`font-size:\\s*${DIM.fontSize}px`));
    expect(word).toMatch(new RegExp(`font-weight:\\s*${DIM.fontWeight}\\b`));
    expect(word).toMatch(new RegExp(`letter-spacing:\\s*${DIM.letterSpacing}px`));
    expect(word).toMatch(/line-height:\s*1\b/);
  });

  it('splash .gk-bar: margin-top 24px / width 132px / height 3px', () => {
    const bar = sliceCss(splashSrc, '.gk-bar ');
    expect(bar).toMatch(new RegExp(`margin-top:\\s*${DIM.barGap}px`));
    expect(bar).toMatch(new RegExp(`width:\\s*${DIM.barW}px`));
    expect(bar).toMatch(new RegExp(`height:\\s*${DIM.barH}px`));
  });

  it('splash .gk-bar::after: width 38% (= CFG.SWEEP_RATIO 0.38)', () => {
    const after = sliceCss(splashSrc, '.gk-bar::after');
    expect(after).toMatch(new RegExp(`width:\\s*${DIM.sweepPct}%`));
  });

  it('splash animation: gk-pulse 1.6s / gk-slide 1.15s (= CFG 1600 / 1150)', () => {
    expect(splashSrc).toMatch(/gk-pulse\s+1\.6s/);
    expect(splashSrc).toMatch(/gk-slide\s+1\.15s/);
  });

  it('splash 背景 = #0a0a0a (#geek-splash と body)', () => {
    expect(splashSrc).toMatch(new RegExp(`background:\\s*${esc(BG)}`));
  });
});

// ------------------------------------------------------------
// helper: CSS ソースから「セレクタ { ... }」ブロックを 1 つ切り出す。
//   厳密な CSS パースは不要 — selector 出現位置から次の '}' までを返す軽量版。
//   見つからなければ即 fail させて「セレクタ名が変わった」ことに気付けるようにする。
// ------------------------------------------------------------
function sliceCss(src: string, selector: string): string {
  const at = src.indexOf(selector);
  if (at === -1) {
    throw new Error(
      `[introSplashLock] セレクタ "${selector}" が web-postbuild.mjs に見つからない ` +
        `(splash の構造が変わった可能性)。intro と splash の一致を見直すこと。`,
    );
  }
  const open = src.indexOf('{', at);
  const close = src.indexOf('}', open);
  return src.slice(open, close + 1);
}
