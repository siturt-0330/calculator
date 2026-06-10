// ============================================================
// hooks/appFontSources.web.ts — web 用 font 実体 (NotoSansJP を除外)
// ------------------------------------------------------------
// web では NotoSansJP を useFonts で bundle せず、scripts/inject-jp-fonts.mjs が
// dist に注入する woff2 + unicode-range subset の @font-face に委譲する。
// @font-face の font-family は 'NotoSansJP_400Regular' / 'NotoSansJP_700Bold' =
// native (appFontSources.ts) と同じ名前にしてあるので、design/typography.ts の
// 参照名はそのまま解決される。これで web bundle から NotoSansJP の .ttf (~8.8MB) が
// 落ち、表示時に必要な subset スライスだけ demand-driven で DL される (8.8MB→数百KB)。
//
// ★ .web.ts でファイルごと分けるのが要点: `if (Platform.OS==='web')` の条件付き
//   require では Metro が .ttf を web bundle に巻き込む恐れがある (静的解析で枝刈り
//   されない)。.web.ts なら NotoSansJP の require がそもそもソースに存在しないので
//   確実に除外される (repo の hooks/use-color-scheme.web.ts と同じ platform 拡張子パターン)。
// ============================================================
export const FONT_SOURCES = {
  Syne_700Bold: require('@expo-google-fonts/syne/Syne_700Bold.ttf'),
  Inter_400Regular: require('@expo-google-fonts/inter/Inter_400Regular.ttf'),
  Inter_600SemiBold: require('@expo-google-fonts/inter/Inter_600SemiBold.ttf'),
  Inter_700Bold: require('@expo-google-fonts/inter/Inter_700Bold.ttf'),
  Orbitron_900Black: require('@expo-google-fonts/orbitron/900Black/Orbitron_900Black.ttf'),
};
