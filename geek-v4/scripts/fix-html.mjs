import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = join(process.cwd(), 'dist');
const file = join(dist, 'index.html');
let html = readFileSync(file, 'utf8');

// Netlify SPA フォールバック (リロード / deep link で 404 にならない)
writeFileSync(join(dist, '_redirects'), '/*    /index.html   200\n');
writeFileSync(
  join(dist, 'netlify.toml'),
  `[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
`,
);


// lang を ja に
html = html.replace('<html lang="en">', '<html lang="ja" translate="no">');

// 高画質テキスト描画 + viewport + OG / Twitter Card
const SITE_URL = 'https://geek-app.netlify.app';  // 必要なら本番ドメインに変える
const inject = `    <meta name="google" content="notranslate" />
    <meta name="robots" content="notranslate, index, follow" />
    <meta name="format-detection" content="telephone=no" />
    <meta name="theme-color" content="#0a0a0a" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1" />
    <meta name="description" content="Geek — 匿名で趣味を語る SNS。テキストスタンプで共感が本人に届く。" />

    <!-- Open Graph (Facebook / LINE / Discord / Slack) -->
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Geek" />
    <meta property="og:title" content="Geek — 匿名で趣味を語る SNS" />
    <meta property="og:description" content="共感が本人に届く、新しい匿名 SNS。あなたの推しを、もっと深く語ろう。" />
    <meta property="og:url" content="${SITE_URL}" />
    <meta property="og:image" content="${SITE_URL}/og-image.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:locale" content="ja_JP" />

    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="Geek — 匿名で趣味を語る SNS" />
    <meta name="twitter:description" content="共感が本人に届く、新しい匿名 SNS。あなたの推しを、もっと深く語ろう。" />
    <meta name="twitter:image" content="${SITE_URL}/og-image.png" />

    <link rel="canonical" href="${SITE_URL}" />
    <style>
      html, body, #root, * {
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        text-rendering: optimizeLegibility;
      }
      body {
        background: #000;
        overflow-x: hidden;
      }
    </style>
`;
// 既存の viewport タグを除去してから差し込む
html = html.replace(/<meta name="viewport"[^/]*\/>\s*/g, '');
html = html.replace('<title>Geek</title>', `${inject}    <title>Geek</title>`);

writeFileSync(file, html);
console.log('✓ Patched dist/index.html (lang=ja, notranslate, hi-DPI text)');
console.log('✓ Wrote dist/_redirects + dist/netlify.toml (SPA fallback)');
