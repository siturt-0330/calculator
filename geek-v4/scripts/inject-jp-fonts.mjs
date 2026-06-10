// ============================================================
// scripts/inject-jp-fonts.mjs — NotoSansJP を woff2 + unicode-range subset で web に供給
// ------------------------------------------------------------
// なぜ: web bundle から NotoSansJP の .ttf (~8.8MB) を外し (hooks/appFontSources.web.ts で
// useFonts から除外済)、代わりに @fontsource/noto-sans-jp の woff2 subset スライスを
// dist に配置 + @font-face CSS を注入する。ブラウザは unicode-range に従い「実際に表示
// される文字のスライスだけ」を demand-driven で DL するので転送量が 8.8MB→数百KB になる
// (初回 ~150-250KB / 多漢字セッションでも ~400-700KB)。
//
// やること (expo export 後・web-postbuild の後に実行):
//   1) @fontsource/noto-sans-jp/files の 400/700 normal woff2 (各125スライス) を dist/fonts/ へコピー
//   2) 400.css / 700.css を読み、font-family を GEEK の固有名 (NotoSansJP_400Regular /
//      NotoSansJP_700Bold = native と同じ名前) に置換 + url を /fonts/ に書換 +
//      woff フォールバック除去 → dist/fonts/noto-sans-jp.css に書き出す
//   3) dist/index.html に <link rel=preload as=style onload=...> で非ブロッキング読込を注入
//
// ★ web-postbuild.mjs (splash 確定版・CLAUDE.md §0) には触らない。別 marker で idempotent。
// ★ font-family の固有名は design/typography.ts の参照名と一致させること (変えると全文字 fallback 化)。
// ★ font-display:swap (fontsource 既定) + +html / web-postbuild の system-font cascade が
//   あるので、woff2 到着前は system JP フォントで読める (FOIT にならない)。
// ============================================================
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const PKG = join(ROOT, 'node_modules', '@fontsource', 'noto-sans-jp');
const FILES_DIR = join(PKG, 'files');
const DIST = join(ROOT, 'dist');
const DIST_FONTS = join(DIST, 'fonts');
const INDEX = join(DIST, 'index.html');
const CSS_OUT = join(DIST_FONTS, 'noto-sans-jp.css');
const CSS_HREF = '/fonts/noto-sans-jp.css';
const MARKER = 'geek-fonts-jp';

if (!existsSync(INDEX)) {
  console.warn('[inject-jp-fonts] dist/index.html not found — skip');
  process.exit(0);
}
if (!existsSync(PKG) || !existsSync(FILES_DIR)) {
  // dep 未導入でも build は壊さない (web は system JP フォントに fallback)。
  console.warn('[inject-jp-fonts] @fontsource/noto-sans-jp not installed — skip');
  process.exit(0);
}

let html = readFileSync(INDEX, 'utf8');
if (html.includes(MARKER)) {
  console.log('[inject-jp-fonts] already injected — skip');
  process.exit(0);
}

// 1) woff2 (400 + 700 の全 subset スライス) を dist/fonts/ へコピー
mkdirSync(DIST_FONTS, { recursive: true });
const woff2 = readdirSync(FILES_DIR).filter(
  (f) => f.endsWith('.woff2') && (f.includes('-400-normal') || f.includes('-700-normal')),
);
for (const f of woff2) copyFileSync(join(FILES_DIR, f), join(DIST_FONTS, f));

// 2) CSS を「固有 family 名 + /fonts/ url + woff2 only」に変換
function transform(weightFile, family) {
  let css = readFileSync(join(PKG, weightFile), 'utf8');
  // fontsource の family 'Noto Sans JP' → GEEK 固有名 (typography.ts 参照名)
  css = css.replace(/font-family: 'Noto Sans JP'/g, `font-family: '${family}'`);
  // url(./files/xxx) → url(/fonts/xxx)
  css = css.replace(/url\(\.\/files\//g, 'url(/fonts/');
  // モダンブラウザのみ対象 → woff フォールバック ", url(/fonts/xxx.woff) format('woff')" を除去
  css = css.replace(/, url\(\/fonts\/[^)]+\.woff\) format\('woff'\)/g, '');
  return css;
}
const css =
  '/* GEEK: NotoSansJP woff2 + unicode-range subset (demand-driven). 生成元 @fontsource/noto-sans-jp */\n' +
  transform('400.css', 'NotoSansJP_400Regular') +
  '\n' +
  transform('700.css', 'NotoSansJP_700Bold');
writeFileSync(CSS_OUT, css);

// 3) index.html に非ブロッキングで <link> 注入 (preload→stylesheet swap)。
//    render はブロックしない (font-display:swap + system-font cascade で読める)。
const linkInject =
  `    <link rel="preload" href="${CSS_HREF}" as="style" onload="this.onload=null;this.rel='stylesheet'" data-${MARKER}="1" />\n` +
  `    <noscript><link rel="stylesheet" href="${CSS_HREF}" /></noscript>\n`;

if (html.includes('</head>')) {
  html = html.replace('</head>', linkInject + '  </head>');
  writeFileSync(INDEX, html);
  console.log(
    `[inject-jp-fonts] ✓ ${woff2.length} woff2 を dist/fonts/ へ + @font-face CSS 注入 (NotoSansJP 400/700 demand-driven subset)`,
  );
} else {
  console.warn('[inject-jp-fonts] </head> not found — HTML 未変更');
}
