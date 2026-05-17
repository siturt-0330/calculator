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

// 高画質テキスト描画 + viewport
const inject = `    <meta name="google" content="notranslate" />
    <meta name="robots" content="notranslate" />
    <meta name="format-detection" content="telephone=no" />
    <meta name="theme-color" content="#0a0a0a" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1" />
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
