import { useEffect, useState } from 'react';
import { useFonts } from 'expo-font';

// ============================================================
// フォントは「実使用 weight だけ」を deep import する (バンドル肥大対策)
// ------------------------------------------------------------
// @expo-google-fonts の barrel (`@expo-google-fonts/<family>` の index.js) は
// その family の **全 weight** を `require('./Xxx.ttf')` で列挙している。barrel から
// 1 シンボルでも import すると、未使用 weight の .ttf まで Metro のアセットグラフに
// 巻き込まれ、web export (dist/) に同梱されてしまう。実測 (dist/ 2026-06-06):
//   - NotoSansJP: 6 weight × ~4.3MB = ~26MB 同梱 / 実使用は 400・700 の 2 つだけ
//   - Inter: 9 weight 同梱 / 実使用 3 ・ Syne: 5 / 実使用 1 ・ Orbitron: 6 / 実使用 1
// → barrel を経由せず、使う weight の .ttf を直接 require して未使用 weight を
//   グラフから外す。これだけで font payload を ~20MB 削減 (主に NotoSansJP の 4 weight)。
//   `useFonts` も barrel ('@expo-google-fonts/syne' 等) 経由だと Syne 全 weight を
//   引いてしまうため、expo-font から直接 import する。
//   ※ deep .ttf require は app/+html.tsx の <link rel=preload> で既に使っている前例どおり。
//     require() を「変数宣言の右辺」ではなくオブジェクト値として書くので no-var-requires に触れない。
//
// ★ key (Syne_700Bold 等) は登録される fontFamily 名。design/typography.ts 他が
//   この名前で参照するので **絶対に変えない** (key を変えると全文字が fallback 化)。
//   Orbitron は旧世代 generator のため weight ごとにサブディレクトリ構成
//   (900Black のみ実使用 = "Geek" ロゴ系統 / SPECIFICATION.md § "GEEKロゴ")。
// ============================================================
const FONT_SOURCES = {
  Syne_700Bold: require('@expo-google-fonts/syne/Syne_700Bold.ttf'),
  NotoSansJP_400Regular: require('@expo-google-fonts/noto-sans-jp/NotoSansJP_400Regular.ttf'),
  NotoSansJP_700Bold: require('@expo-google-fonts/noto-sans-jp/NotoSansJP_700Bold.ttf'),
  Inter_400Regular: require('@expo-google-fonts/inter/Inter_400Regular.ttf'),
  Inter_600SemiBold: require('@expo-google-fonts/inter/Inter_600SemiBold.ttf'),
  Inter_700Bold: require('@expo-google-fonts/inter/Inter_700Bold.ttf'),
  Orbitron_900Black: require('@expo-google-fonts/orbitron/900Black/Orbitron_900Black.ttf'),
};

// パフォーマンス監査: フォントが 100ms 以内に読み込めなければシステムフォントで
// 先行レンダーを許可する。これで「起動直後に黒い」体感を解消し FCP/LCP を 80-120ms 短縮。
// ※ [実証済] app/+html.tsx の <link rel="preload"> は **web の single export では
//   dist/index.html に反映されない** (Expo が +html.tsx を single 出力に適用しないため。
//   scripts/web-postbuild.mjs のヘッダコメント参照)。よって web 本番では preload による
//   font 前倒しは効いておらず、この 100ms は純粋に fallback の安全弁。フォントは元々
//   first paint をブロックしない (下の forceFallback + system-font cascade) ので実害は
//   ないが、preload を本番に効かせたいなら web-postbuild.mjs 側に注入する必要がある。
const FONT_FALLBACK_TIMEOUT_MS = 100;

export function useAppFonts(): boolean {
  const [loaded, error] = useFonts(FONT_SOURCES);

  // フォント timeout fallback — 100ms 以内に読み込まれなければシステムフォントで進める
  const [forceFallback, setForceFallback] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setForceFallback(true), FONT_FALLBACK_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, []);

  // 読込完了 / エラー / timeout のいずれかで OK
  return loaded || !!error || forceFallback;
}
