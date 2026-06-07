// ============================================================
// og-image: HMAC 署名つき画像プロキシ (Camo / GitHub 方式)
// ============================================================
// 目的 (deep-research の最重要結論):
//   リンクプレビューの OG 画像を「クライアントから外部ホストへ直接 fetch」
//   させると、閲覧者の IP / User-Agent が相手サーバに渡る (receiver-side
//   leak)。攻撃者が自分の logging server へのリンクを投稿すれば、被害者は
//   タップ無しで画像を読みに行き IP/位置が記録される。これを構造的に塞ぐため
//   OG 画像は **必ず GEEK サーバ (= この Edge Function) 経由** で配信する。
//   前例: GitHub Camo (HMAC 署名つき画像プロキシ) / Mastodon gamo。
//
// 入力 (GET):
//   ?u=<元画像 URL (encodeURIComponent 済)>
//   &sig=<HMAC-SHA256(secret, 元画像URL) の hex>
//   secret = Deno.env OG_IMAGE_PROXY_SECRET (app 側が署名 URL を生成)
//
// 動作:
//   1. sig を timing-safe 比較で検証。欠落/不一致は即 403 + fetch しない
//      (open relay 防止 — go-camo と同じく「署名済 URL のみ proxy 可」)。
//   2. 元 URL を SSRF ガード (_shared/ssrf.ts) で検証
//      (http/https のみ・private/loopback/link-local/IPv6/metadata 拒否、
//       可能なら DNS 解決して解決後 IP も分類)。
//   3. redirect:'manual' で fetch。3xx は Location を各 hop 再検証して追従
//      (リダイレクト経由の SSRF bypass を防ぐ)。
//   4. timeout ~6s / サイズ上限 ~5MB / content-type が image/* の時のみ。
//   5. 成功時は画像バイトを content-type のまま + 長め immutable Cache-Control
//      で返す。失敗時は 1x1 透明 png (壊れた画像を返さない)。
//   6. stack / secret を一切漏らさない。
//
// セキュリティ方針:
//   - 署名検証を最優先 (fetch 前)。署名が通らなければ一切 fetch しない。
//   - SSRF: _shared/ssrf.ts を og-fetch と共有 (DRY)。
//   - CORS: _shared/cors.ts の Origin allowlist を流用。
//     ただし <img src> は preflight しないため method は GET を明示。
//
//   **deploy は別途** (`supabase functions deploy og-image`)。
//   secret は `supabase secrets set OG_IMAGE_PROXY_SECRET=...`。
//   app 側 (lib/) は同 secret で u/sig を生成して <img> に挿す (別タスク)。
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { timingSafeEqual } from 'https://deno.land/std@0.168.0/crypto/timing_safe_equal.ts';
import { buildCorsHeaders } from '../_shared/cors.ts';
import { assertHostResolvesToPublic, validateUrl } from '../_shared/ssrf.ts';

const PROXY_SECRET = Deno.env.get('OG_IMAGE_PROXY_SECRET') ?? '';

// fetch の上限値
const FETCH_TIMEOUT_MS = 6000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_REDIRECTS = 4;
const USER_AGENT = 'GeekBot/1.0 (+link-preview image proxy)';

// 成功画像の Cache-Control。署名 URL は内容アドレス的 (u が変われば sig も変わる)
// なので immutable で長期キャッシュして CDN / ブラウザ負荷を下げる。
const SUCCESS_CACHE_CONTROL = 'public, max-age=86400, s-maxage=604800, immutable';
// 失敗 (透明 png) は短め — 一時障害が長期キャッシュされないように。
const FAILURE_CACHE_CONTROL = 'public, max-age=60';

// 1x1 透明 PNG (壊れた画像アイコンを出さないためのフォールバック)
// deno-fmt-ignore
const TRANSPARENT_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

// ------------------------------------------------------------
// hex helpers
// ------------------------------------------------------------
function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function hexToBytes(hex: string): Uint8Array | null {
  const clean = hex.trim().toLowerCase();
  if (clean.length === 0 || clean.length % 2 !== 0) return null;
  if (!/^[0-9a-f]+$/.test(clean)) return null;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

// ------------------------------------------------------------
// HMAC-SHA256(secret, message) を hex で返す
// ------------------------------------------------------------
async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return bytesToHex(new Uint8Array(sig));
}

// ------------------------------------------------------------
// timing-safe 比較
// ------------------------------------------------------------
// 受信 sig (hex) と期待 HMAC (hex) を定数時間で比較する。
// - 受信値が hex として不正なら即 false (ここは秘密に依存しないので OK)。
// - 比較は Deno std の timingSafeEqual に委譲 (内容/長さで分岐しない実装)。
//   期待値は常に 32byte の HMAC-SHA256。受信が違う長さなら std 実装が
//   定数時間で false を返す。
function timingSafeEqualHex(received: string, expectedHex: string): boolean {
  const recvBytes = hexToBytes(received);
  if (!recvBytes) return false;
  const expBytes = hexToBytes(expectedHex);
  if (!expBytes) return false;
  return timingSafeEqual(recvBytes, expBytes);
}

// ------------------------------------------------------------
// レスポンス本文を最大 MAX_IMAGE_BYTES まで読む。超過は null (爆弾防止)。
// ------------------------------------------------------------
async function readCappedImage(res: Response): Promise<Uint8Array | null> {
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.length > MAX_IMAGE_BYTES ? null : buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let overflow = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        received += value.length;
        if (received > MAX_IMAGE_BYTES) {
          overflow = true; // 上限超過 → 読み捨てて中断
          break;
        }
        chunks.push(value);
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // cancel 失敗は無視
    }
  }
  if (overflow) return null;
  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

// ------------------------------------------------------------
// content-type が image/* か (パラメータ付き image/png; charset=... も許容)
// ------------------------------------------------------------
function isImageContentType(ct: string): boolean {
  const main = ct.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (!main.startsWith('image/')) return false;
  // SVG は XSS/JS 実行のリスクがあるため画像プロキシでは拒否
  // (image/svg+xml は <script>/onload を含められ、同一オリジン配信だと危険)
  if (main === 'image/svg+xml' || main === 'image/svg') return false;
  return true;
}

// ------------------------------------------------------------
// SSRF を通った URL を redirect:'manual' で fetch。
// 3xx は Location を各 hop 再検証して MAX_REDIRECTS まで追従。
// 成功時は最終レスポンス (200, body 未読) を返す。失敗時は null。
// ------------------------------------------------------------
async function fetchImageFollowingRedirects(
  startUrl: string,
  signal: AbortSignal,
): Promise<Response | null> {
  let currentUrl = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(currentUrl, {
      method: 'GET',
      redirect: 'manual', // 各 hop を自前で再検証する (自動追従させない)
      signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'image/*',
      },
    });

    const status = res.status;
    // 3xx + Location → リダイレクト。各 hop で再 SSRF 検証してから追従。
    if (status >= 300 && status < 400) {
      const location = res.headers.get('location');
      // body は捨てる
      try {
        await res.body?.cancel();
      } catch {
        // 無視
      }
      if (!location || hop === MAX_REDIRECTS) return null; // 上限到達 or Location 欠落
      let nextUrl: string;
      try {
        nextUrl = new URL(location, currentUrl).toString(); // 相対 Location を絶対化
      } catch {
        return null;
      }
      const safeNext = validateUrl(nextUrl); // http/https + private 等を再拒否
      if (!safeNext) return null;
      const dnsOk = await assertHostResolvesToPublic(new URL(safeNext).hostname);
      if (dnsOk === false) return null; // 内部 IP に解決 → 拒否
      currentUrl = safeNext;
      continue;
    }

    // 非 3xx はここで確定 (200 系もエラー系も呼び出し側で判定)
    return res;
  }
  return null;
}

// ------------------------------------------------------------
// 透明 png フォールバック応答 (壊れた画像を返さない)
// ------------------------------------------------------------
function transparentPngResponse(req: Request): Response {
  return new Response(TRANSPARENT_PNG, {
    status: 200,
    headers: {
      ...buildCorsHeaders(req),
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Content-Type': 'image/png',
      'Content-Length': String(TRANSPARENT_PNG.length),
      'Cache-Control': FAILURE_CACHE_CONTROL,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

// ------------------------------------------------------------
// 403 (署名不正)。本文は最小限、secret/詳細は一切出さない。
// ------------------------------------------------------------
function forbidden(req: Request): Response {
  return new Response('forbidden', {
    status: 403,
    headers: {
      ...buildCorsHeaders(req),
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        ...buildCorsHeaders(req),
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      },
    });
  }

  // GET 以外は拒否 (画像 proxy は GET のみ)
  if (req.method !== 'GET') {
    return forbidden(req);
  }

  try {
    // secret 未設定なら proxy は機能しない。fail-closed で 403
    // (誤って open relay 化しないように)。
    if (!PROXY_SECRET) {
      return forbidden(req);
    }

    const url = new URL(req.url);
    const rawTarget = url.searchParams.get('u');
    const sig = url.searchParams.get('sig');

    // ── 1. 署名検証を最優先 (fetch する前) ───────────────────
    // u / sig 欠落は即 403。fetch しない (open relay 防止)。
    if (!rawTarget || !sig) {
      return forbidden(req);
    }
    // 署名対象は「デコード後の元画像 URL 文字列」。app 側も同じ文字列に署名する。
    // 不正な percent-encoding は decode で throw しうる → 署名検証に到達しえない
    // (= 有効な sig を持てない) ので 403 で弾く。
    let targetUrl: string;
    try {
      targetUrl = decodeURIComponent(rawTarget);
    } catch {
      return forbidden(req);
    }
    const expected = await hmacSha256Hex(PROXY_SECRET, targetUrl);
    const sigOk = timingSafeEqualHex(sig, expected);
    if (!sigOk) {
      return forbidden(req);
    }

    // ── 2. SSRF ガード (静的) ────────────────────────────────
    // 署名が通っても、署名時点と内容が同じである保証はあるが「元 URL 自体が
    // 内部宛て」なケース (app 側のバグ / 将来の経路) を二重で防ぐ。
    const safeUrl = validateUrl(targetUrl);
    if (!safeUrl) {
      // 署名は正しいが宛先が不正 → 壊れた画像ではなく透明 png
      return transparentPngResponse(req);
    }
    // ── 2b. DNS 解決して解決後 IP も分類 (DNS rebinding 入口を塞ぐ) ──
    const dnsOk = await assertHostResolvesToPublic(new URL(safeUrl).hostname);
    if (dnsOk === false) {
      return transparentPngResponse(req);
    }

    // ── 3-4. fetch (redirect manual / timeout / size / image-only) ──
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetchImageFollowingRedirects(safeUrl, controller.signal);
      if (!res || !res.ok) {
        try {
          await res?.body?.cancel();
        } catch {
          // 無視
        }
        return transparentPngResponse(req);
      }

      const contentType = res.headers.get('content-type') ?? '';
      if (!isImageContentType(contentType)) {
        // image/* 以外 (html/json/svg 等) は読まずに破棄
        try {
          await res.body?.cancel();
        } catch {
          // 無視
        }
        return transparentPngResponse(req);
      }

      const bytes = await readCappedImage(res);
      if (!bytes || bytes.length === 0) {
        // サイズ超過 (画像爆弾) or 空 → 透明 png
        return transparentPngResponse(req);
      }

      // ── 5. 画像バイトを content-type のまま + immutable で返す ──
      const safeContentType = contentType.split(';', 1)[0]?.trim() ?? 'application/octet-stream';
      return new Response(bytes, {
        status: 200,
        headers: {
          ...buildCorsHeaders(req),
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Content-Type': safeContentType,
          'Content-Length': String(bytes.length),
          'Cache-Control': SUCCESS_CACHE_CONTROL,
          // 配信時の sniff / iframe 埋め込み / 参照漏れを抑止
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; sandbox",
          'Referrer-Policy': 'no-referrer',
          'Cross-Origin-Resource-Policy': 'cross-origin',
        },
      });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // timeout / network / 想定外エラーでも stack/secret を漏らさず透明 png
    return transparentPngResponse(req);
  }
});
