import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

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
//
// アイコン / manifest は public/ 配下に置く (Expo が dist root にコピー)。
// ============================================================

const APP_NAME = 'GEEK';
const APP_DESC = '推し活・オタク文化のための完全匿名型 SNS。タグでつながる、構造的に安全なコミュニティ。';
const SITE_URL = 'https://geek.app';
const OG_IMAGE = '/og-image.png'; // public/og-image.png に配置 (未配置でもクロール時 noindex にはならない)
const THEME    = '#0a0a0a';       // splash と合わせる
const ACCENT   = '#7C6AF7';       // ブランド色

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
          react-native-web の推奨スタイルリセット — body を full-height にして
          <ScrollView> が body スクロールではなく内部スクロールで動くようにする。
        */}
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
