import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';
import { Asset } from 'expo-asset';

// ============================================================
// app/+html.tsx
// ============================================================
// Expo Router の Web (static) export 時に各ページの HTML wrapper として
// 使われるテンプレート。<head> の中身を完全制御できる唯一の場所。
//
// ここで定義しているもの:
//   - title / description / theme-color
//   - PWA manifest link (/manifest.json)
//   - favicon / apple-touch-icon
//   - OpenGraph / Twitter card meta
//   - Critical font preload + system-font fallback CSS (FOIT/FOUC 対策)
//
// アイコン / manifest は public/ 配下に置く (Expo が dist root にコピー)。
// ============================================================

const APP_NAME = 'GEEK';
const APP_DESC = '推し活・オタク文化のための完全匿名型 SNS。タグでつながる、構造的に安全なコミュニティ。';
const SITE_URL = 'https://geek.app';
const OG_IMAGE = '/og-image.png'; // public/og-image.png に配置 (未配置でもクロール時 noindex にはならない)
const THEME    = '#0a0a0a';       // splash と合わせる
const ACCENT   = '#7C6AF7';       // ブランド色

// ============================================================
// Critical font preload
// ============================================================
// Web の first paint で最初に必要になる 3 つの font weight を <link rel="preload">
// で先行ダウンロードさせ、useAppFonts() の loadAsync より早くネットワーク要求を
// キックする。これで font の到着が typical 100-200ms 早まり、100ms timeout fallback
// に切り替わる前に "本来の" font で描画できる確率が上がる。
//   - Inter_700Bold: UI の太字 (button / heading の英文)
// ※ NotoSansJP は web では woff2 + unicode-range subset に移行したので preload から外した
//   (scripts/inject-jp-fonts.mjs が dist に @font-face を注入する)。.ttf を web bundle に
//   引き戻さないよう、ここでも NotoSansJP の require を削除している。+html.tsx 自体は
//   single export では dist に反映されないが、念のため require 経路も断つ。
// require() は Metro web target で hashed asset URL に inline 解決される。
// Asset.fromModule(require(...)).uri は SSR / runtime どちらでも安全に動く。
// 解決に失敗した build (Asset registry 未初期化等) は uri=null を返し、
// preload を skip して旧挙動 (useAppFonts 経由) にフォールバックする。
// ============================================================
function resolveFontUri(mod: unknown): string | null {
  try {
    const asset = Asset.fromModule(mod as number);
    return asset?.uri ?? null;
  } catch {
    return null;
  }
}

const PRELOAD_FONTS: { uri: string | null; family: string }[] = [
  {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    uri: resolveFontUri(require('@expo-google-fonts/inter/Inter_700Bold.ttf')),
    family: 'Inter_700Bold',
  },
];

// font が届くまでの fallback cascade — Apple system → 日本語 fallback の順。
// LOGO_FONT の cascade (-apple-system, BlinkMacSystemFont, ...) を body まで拡張し、
// FOIT (Flash Of Invisible Text) ではなく FOUT (Flash Of Unstyled Text) に倒す。
// expo-font の loadAsync は内部で FontFace API で font-display: swap 相当だが、
// custom fontFamily 名が解決されるまでは system font に fallback したい。
const FONT_FALLBACK_CSS =
  `html,body{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Helvetica Neue","Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic","Meiryo",Inter,system-ui,sans-serif;text-rendering:optimizeLegibility;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}`;

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="ja">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"
        />

        {/* eslint-disable-next-line react-native/no-raw-text */}
        <title>{APP_NAME} — 推し活の匿名 SNS</title>
        <meta name="description" content={APP_DESC} />
        <meta name="theme-color" content={THEME} />
        <meta name="color-scheme" content="dark light" />
        <link rel="canonical" href={SITE_URL} />

        {/* PWA */}
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" type="image/png" href="/favicon.png" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <link rel="apple-touch-icon" sizes="192x192" href="/icon-192.png" />
        <link rel="apple-touch-icon" sizes="512x512" href="/icon-512.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content={APP_NAME} />

        {/* OpenGraph */}
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={APP_NAME} />
        <meta property="og:title" content={`${APP_NAME} — 推し活の匿名 SNS`} />
        <meta property="og:description" content={APP_DESC} />
        <meta property="og:url" content={SITE_URL} />
        <meta property="og:image" content={`${SITE_URL}${OG_IMAGE}`} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:locale" content="ja_JP" />

        {/* Twitter */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={`${APP_NAME} — 推し活の匿名 SNS`} />
        <meta name="twitter:description" content={APP_DESC} />
        <meta name="twitter:image" content={`${SITE_URL}${OG_IMAGE}`} />

        {/* Misc */}
        <meta name="msapplication-TileColor" content={ACCENT} />
        <meta name="format-detection" content="telephone=no" />
        <meta name="referrer" content="strict-origin-when-cross-origin" />

        {/*
          ★ パフォーマンス: critical font を <link rel="preload"> でブラウザに
          先行ダウンロードさせる。useAppFonts() の loadAsync() より早くキック
          できるので、100ms timeout fallback が発火する前に本来の font が届く
          確率が上がる (FOIT/FOUC 低減)。
          uri が null の build (SSR で Asset registry が解決できないケース) は
          安全に preload を skip — 旧挙動 (useAppFonts 経由) にフォールバックする。
        */}
        {PRELOAD_FONTS.map((f) =>
          f.uri ? (
            <link
              key={f.family}
              rel="preload"
              as="font"
              type="font/ttf"
              href={f.uri}
              crossOrigin="anonymous"
            />
          ) : null,
        )}

        {/*
          ★ パフォーマンス: font が届くまでの fallback cascade を <head> 内で
          inline 注入。Apple system → Hiragino → Yu Gothic → Inter → sans-serif
          の順で、custom font が読み込まれるまで完全に "読める" 状態を維持する。
          FOIT (Flash Of Invisible Text) ではなく FOUT (Flash Of Unstyled Text)
          に倒すための要。useAppFonts() が完了 or 100ms timeout fallback した
          後は fontFamily が token から上書きされる。
        */}
        <style
          dangerouslySetInnerHTML={{
            __html: FONT_FALLBACK_CSS,
          }}
        />

        {/*
          react-native-web の推奨スタイルリセット — body を full-height にして
          <ScrollView> が body スクロールではなく内部スクロールで動くようにする。
        */}
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
