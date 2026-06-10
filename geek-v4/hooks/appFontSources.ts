// ============================================================
// hooks/appFontSources.ts — useFonts に渡す font 実体 (native + default)
// ------------------------------------------------------------
// @expo-google-fonts の barrel (`@expo-google-fonts/<family>` の index.js) は
// その family の **全 weight** を require で列挙する。barrel から 1 シンボルでも
// import すると未使用 weight の .ttf まで Metro アセットグラフに巻き込まれ bundle に
// 同梱される。→ barrel を経由せず、使う weight の .ttf を直接 deep require して
// 未使用 weight をグラフから外す (web export で ~20MB 削減した実績)。
//
// ★ key (Syne_700Bold 等) は登録される fontFamily 名。design/typography.ts 他が
//   この名前で参照するので **絶対に変えない** (key を変えると全文字が fallback 化)。
//   Orbitron は旧世代 generator のため weight ごとにサブディレクトリ構成。
//
// ※ web 版は appFontSources.web.ts。web は NotoSansJP をここから除外し、woff2 +
//   unicode-range subset の @font-face (scripts/inject-jp-fonts.mjs が dist に注入) に
//   委譲する (web bundle から NotoSansJP .ttf ~8.8MB を落とす)。Metro は web で .web.ts を
//   解決するので、web bundle に NotoSansJP の require がそもそも入らない。native は
//   woff2 を使えないのでここで .ttf を全て require する。
// ============================================================
export const FONT_SOURCES = {
  Syne_700Bold: require('@expo-google-fonts/syne/Syne_700Bold.ttf'),
  NotoSansJP_400Regular: require('@expo-google-fonts/noto-sans-jp/NotoSansJP_400Regular.ttf'),
  NotoSansJP_700Bold: require('@expo-google-fonts/noto-sans-jp/NotoSansJP_700Bold.ttf'),
  Inter_400Regular: require('@expo-google-fonts/inter/Inter_400Regular.ttf'),
  Inter_600SemiBold: require('@expo-google-fonts/inter/Inter_600SemiBold.ttf'),
  Inter_700Bold: require('@expo-google-fonts/inter/Inter_700Bold.ttf'),
  Orbitron_900Black: require('@expo-google-fonts/orbitron/900Black/Orbitron_900Black.ttf'),
};
