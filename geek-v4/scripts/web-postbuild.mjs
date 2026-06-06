// ============================================================
// scripts/web-postbuild.mjs — expo export 後の dist/index.html 強化
// ------------------------------------------------------------
// なぜ必要か (パフォーマンス: 最初のロードが遅い問題の核心):
//   expo export が吐く dist/index.html は <div id="root"></div> が空 + body に
//   背景色が無い「ほぼ素」の SPA shell。よって mobile では 5.7MB の JS bundle が
//   download+parse され React が mount するまで、ユーザーは **真っ白な空画面** を
//   数秒間見続ける (回線が細いほど長い)。app/+html.tsx は単一 (single) 出力では
//   適用されず、この shell には反映されない。
//
// この後処理スクリプトで dist/index.html に以下を注入する:
//   1) body 背景を app と同じダーク (#0a0a0a) に → 白フラッシュを消す
//   2) ブランド付き instant splash (Geek ワードマーク + 進捗バー) を素の HTML/CSS で
//      描画 → JS 到着前 (HTML だけで ~100-300ms) に「読み込み中」が見える
//   3) React が #root に mount したら splash を fade-out して除去 (MutationObserver)
//   4) Supabase への preconnect/dns-prefetch → 最初の feed RTT の DNS/TLS を前倒し
//
// ★ Service Worker は **入れない** (scripts/fix-html.mjs の cache-first SW は
//   「古い shell が残る」事故源 — project_geek_v4_web_freshness 参照)。ここでは
//   shell を一切キャッシュしない。
//
// idempotent: 既に注入済みなら skip。markers が見つからなければ warn して no-op
// (build を壊さない)。
// ============================================================
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SUPABASE_ORIGIN = 'https://migpiwdlpwpvehzvdjyh.supabase.co';
const MARKER = 'geek-splash-style';

const file = join(process.cwd(), 'dist', 'index.html');
if (!existsSync(file)) {
  console.warn('[web-postbuild] dist/index.html not found — skip');
  process.exit(0);
}

let html = readFileSync(file, 'utf8');

if (html.includes(MARKER)) {
  console.log('[web-postbuild] splash already injected — skip');
  process.exit(0);
}

// --- 1) <head> 注入: preconnect + 背景 + splash CSS ---------------------------
const headInject = `    <link rel="preconnect" href="${SUPABASE_ORIGIN}" crossorigin />
    <link rel="dns-prefetch" href="${SUPABASE_ORIGIN}" />
    <style id="${MARKER}">
      html, body { background-color: #0a0a0a; }
      #geek-splash {
        position: fixed; inset: 0; z-index: 99999;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        background: #0a0a0a;
        opacity: 1; transition: opacity .35s ease;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", sans-serif;
      }
      #geek-splash.geek-hide { opacity: 0; pointer-events: none; }
      #geek-splash .gk-word {
        font-size: 46px; font-weight: 800; letter-spacing: -1px; line-height: 1;
        background: linear-gradient(120deg, #7C6AF7 0%, #B98CFF 48%, #E891C7 100%);
        -webkit-background-clip: text; background-clip: text;
        -webkit-text-fill-color: transparent; color: transparent;
        animation: gk-pulse 1.6s ease-in-out infinite;
      }
      #geek-splash .gk-bar {
        margin-top: 24px; width: 132px; height: 3px; border-radius: 99px;
        background: rgba(255,255,255,.08); overflow: hidden;
      }
      #geek-splash .gk-bar::after {
        content: ""; display: block; width: 38%; height: 100%; border-radius: 99px;
        background: linear-gradient(90deg, #7C6AF7, #E891C7);
        animation: gk-slide 1.15s cubic-bezier(.4,0,.2,1) infinite;
      }
      @keyframes gk-pulse { 0%,100% { opacity: 1 } 50% { opacity: .5 } }
      @keyframes gk-slide { 0% { transform: translateX(-130%) } 100% { transform: translateX(360%) } }
      @media (prefers-reduced-motion: reduce) {
        #geek-splash .gk-word { animation: none }
        #geek-splash .gk-bar::after { animation: none; transform: translateX(85%) }
      }
    </style>
`;

// --- 2) splash DOM (#root の直前に置く) --------------------------------------
const splashDom = `<div id="geek-splash" aria-hidden="true"><div class="gk-word">Geek</div><div class="gk-bar"></div></div>
    `;

// --- 3) splash 除去 script (React mount を検知して fade-out) ------------------
const removeScript = `<script>
      (function () {
        var s = document.getElementById('geek-splash');
        var r = document.getElementById('root');
        if (!s || !r) return;
        var done = false;
        function hide() {
          if (done) return; done = true;
          s.classList.add('geek-hide');
          setTimeout(function () { if (s && s.parentNode) s.parentNode.removeChild(s); }, 420);
        }
        if (r.childNodes.length > 0) { hide(); return; }
        var mo = new MutationObserver(function () {
          if (r.childNodes.length > 0) { mo.disconnect(); hide(); }
        });
        mo.observe(r, { childList: true });
        // safety: 何があっても 12s で必ず外す (stuck 防止)
        setTimeout(function () { try { mo.disconnect(); } catch (e) {} hide(); }, 12000);
      })();
    </script>
  `;

let ok = true;
if (html.includes('</head>')) {
  html = html.replace('</head>', headInject + '  </head>');
} else { ok = false; }

if (html.includes('<div id="root"></div>')) {
  html = html.replace('<div id="root"></div>', splashDom + '<div id="root"></div>');
} else { ok = false; }

if (html.includes('</body>')) {
  html = html.replace('</body>', removeScript + '</body>');
} else { ok = false; }

if (!ok) {
  console.warn('[web-postbuild] expected markers not found — HTML left unchanged');
  process.exit(0);
}

writeFileSync(file, html);
console.log('[web-postbuild] ✓ injected splash + dark bg + Supabase preconnect into dist/index.html');
