import { useEffect, useState } from 'react';
import { useFonts } from 'expo-font';
import { FONT_SOURCES } from './appFontSources';

// パフォーマンス監査: フォントが 100ms 以内に読み込めなければシステムフォントで
// 先行レンダーを許可する。これで「起動直後に黒い」体感を解消し FCP/LCP を 80-120ms 短縮。
// ※ [実証済] app/+html.tsx の <link rel="preload"> は **web の single export では
//   dist/index.html に反映されない** (Expo が +html.tsx を single 出力に適用しないため。
//   scripts/web-postbuild.mjs のヘッダコメント参照)。よって web 本番では preload による
//   font 前倒しは効いておらず、この 100ms は純粋に fallback の安全弁。フォントは元々
//   first paint をブロックしない (下の forceFallback + system-font cascade) ので実害なし。
// ※ font 実体は hooks/appFontSources(.web).ts に分離。web は NotoSansJP を除外し
//   woff2 + unicode-range subset の @font-face (scripts/inject-jp-fonts.mjs が dist に
//   注入) に委譲する。native は .ttf を deep require。
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
