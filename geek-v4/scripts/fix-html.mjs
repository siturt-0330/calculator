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

// ============================================================
// PWA: manifest.json + service-worker.js
// ============================================================
const manifest = {
  name: 'Geek',
  short_name: 'Geek',
  description: '匿名で趣味を語り、共感が本人に届くSNS',
  start_url: '/',
  display: 'standalone',
  background_color: '#0a0a0a',
  theme_color: '#0a0a0a',
  orientation: 'portrait',
  lang: 'ja',
  icons: [
    { src: '/favicon.ico', sizes: '64x64 32x32 24x24 16x16', type: 'image/x-icon' },
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
  ],
};
writeFileSync(join(dist, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));

const sw = `// Geek Service Worker — keeps the app shell available offline.
const CACHE = 'geek-shell-v3';
const SHELL = ['/', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
  ));
  self.clients.claim();
});

// Strategy: network-first for app shell, fallback to cache.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Supabase realtime / API calls — skip cache
  if (url.hostname.includes('supabase')) return;
  // HTML navigations: network-first, cache fallback
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req).then((r) => r || caches.match('/index.html'))),
    );
    return;
  }
  // Static assets: cache-first
  if (/\\.(?:js|css|woff2?|png|jpg|jpeg|svg|webp|ico|json)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }).catch(() => cached)),
    );
  }
});
`;
writeFileSync(join(dist, 'service-worker.js'), sw);


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

    <!-- PWA -->
    <link rel="manifest" href="/manifest.webmanifest" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="Geek" />
    <script>
      if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
          navigator.serviceWorker.register('/service-worker.js').catch(() => {});
        });
      }
    </script>

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
