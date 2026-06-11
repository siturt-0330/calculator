// ============================================================
// og-fetch: サーバーサイド Open Graph リンクプレビュー取得
// ============================================================
// 入力: POST { url: string }
// 動作:
//   1. SSRF ガード (後述) を通った http(s) URL のみ対象
//   2. GEEK サーバー (= この Edge Function) が当該ページを fetch
//   3. <meta property="og:title|og:description|og:image|og:site_name"> を読む
//   4. service_role で post_link_previews に upsert (RLS / rate-limit を迂回)
//   5. { url, title, description, image_url, site_name, fetched_at } を返す
//
// レスポンス: 常に上記 shape。失敗時は title 等を null にした fail-secure 応答。
//   - クライアントへは stack / secret を一切漏らさない
//   - 例外は全て catch し、never throw to client
//
// セキュリティ方針:
//   - SSRF 対策: private / loopback / link-local IP, localhost, *.local,
//     URL 内 credential (user:pass@) を拒否。拒否時は fetch せず null 応答。
//   - content-type が text/html のときのみ parse。本文は ~512KB で打ち切り。
//   - service_role key は Edge 側でのみ参照 (client には絶対露出しない)
//   - CORS allowlist 方式 (_shared/cors.ts)
//
//   **deploy は別途 (`supabase functions deploy og-fetch`)** —
//   本 file はリポジトリに追加するだけ。deploy するまでは client 側の
//   microlink fallback が使われる。
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { buildCorsHeaders, jsonResponse } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// fetch の上限値
const FETCH_TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 3; // 手動リダイレクト追跡の上限 (各ホップで SSRF 再検証)
const MAX_BODY_BYTES = 512 * 1024; // 512KB
const USER_AGENT = 'GeekBot/1.0 (+link-preview)';

// DB の CHECK 制約に合わせた truncate 上限 (migration 0036)
const MAX_TITLE = 300;
const MAX_DESCRIPTION = 800;
const MAX_IMAGE_URL = 800;
const MAX_SITE_NAME = 100;

type PreviewResult = {
  url: string;
  title: string | null;
  description: string | null;
  image_url: string | null;
  site_name: string | null;
  fetched_at: string;
};

// ------------------------------------------------------------
// fail-secure 応答 — url はそのまま、メタは null
// ------------------------------------------------------------
function nullPreview(url: string): PreviewResult {
  return {
    url,
    title: null,
    description: null,
    image_url: null,
    site_name: null,
    fetched_at: new Date().toISOString(),
  };
}

// ------------------------------------------------------------
// SSRF ガード — private / loopback / link-local を全て拒否する。
// ------------------------------------------------------------
// 攻撃者が og-fetch に内部 URL を渡すと、Edge ランタイムの権限で
// メタデータエンドポイント (169.254.169.254) や内部サービスへ到達できる。
// よって「外部の公開ホスト」以外は fetch する前に弾く (fail-secure)。

// IPv4 ドット 10 進が private/loopback/link-local 範囲か判定
function isBlockedIpv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const octets = [m[1], m[2], m[3], m[4]].map((o) => Number(o));
  // 各オクテットが 0-255 に収まらなければ不正な IP literal として拒否
  if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return true;
  const [a, b] = octets as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 (0.0.0.0 含む)
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT (念のため)
  return false;
}

// IPv6 リテラル (角括弧除去済) が loopback / private / link-local か判定
function isBlockedIpv6(rawHost: string): boolean {
  // URL.hostname は IPv6 を角括弧付きで返すので外す。zone id (%eth0) も除去。
  let h = rawHost.trim().toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  const zone = h.indexOf('%');
  if (zone !== -1) h = h.slice(0, zone);
  if (!h.includes(':')) return false; // IPv6 ではない

  if (h === '::1' || h === '::') return true; // loopback / unspecified
  // IPv4-mapped (::ffff:127.0.0.1 等) は埋め込み v4 を再判定
  const mapped = h.match(/:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped && mapped[1] && isBlockedIpv4(mapped[1])) return true;
  // ★ hex 形の IPv4-mapped (::ffff:7f00:1 = 127.0.0.1) もオクテットへ展開して再判定。
  //   入力が最初から hex 形だと上のドット形 match を素通りして内部 IP へ到達できた (監査 S-5)。
  const hexMapped = h.match(/(?:^|:)ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped && hexMapped[1] && hexMapped[2]) {
    const hi = parseInt(hexMapped[1], 16);
    const lo = parseInt(hexMapped[2], 16);
    if (!Number.isNaN(hi) && !Number.isNaN(lo)) {
      const v4 = `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
      if (isBlockedIpv4(v4)) return true;
    }
  }
  // NAT64 (64:ff9b::/96) 経由の内部 v4 到達も遮断 (翻訳プレフィックスごと拒否)
  if (h.startsWith('64:ff9b:')) return true;

  // 先頭ハイバイトで範囲判定
  const firstGroup = h.split(':').find((g) => g.length > 0) ?? '';
  if (firstGroup) {
    const val = parseInt(firstGroup, 16);
    if (!Number.isNaN(val)) {
      const high = val >> 8; // 上位 8bit
      if ((high & 0xfe) === 0xfc) return true; // fc00::/7 unique-local
      if (high === 0xfe && (val & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    }
  }
  return false;
}

// hostname が拒否対象か (localhost / *.local / bare IP リテラル)
function isBlockedHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) return true;
  if (host === 'localhost') return true;
  if (host.endsWith('.localhost')) return true;
  if (host === 'local' || host.endsWith('.local')) return true; // mDNS / *.local
  if (isBlockedIpv4(host)) return true;
  if (isBlockedIpv6(host)) return true;
  return false;
}

// URL 全体を検証。OK なら正規化済 URL 文字列、NG なら null。
function validateUrl(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null; // パース不能
  }
  // http(s) 以外 (file:, ftp:, gopher:, data: 等) は全て拒否
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  // URL 内 credential (user:pass@host) を拒否
  if (parsed.username || parsed.password) return null;
  if (isBlockedHostname(parsed.hostname)) return null;
  return parsed.toString();
}

// ------------------------------------------------------------
// HTML エンティティのデコード (名前付き + 数値参照)
// ------------------------------------------------------------
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
};

function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    // 数値参照 (&#123; / &#x1F600;)
    if (body[0] === '#') {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const num = isHex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (Number.isNaN(num) || num < 0 || num > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(num);
      } catch {
        return whole;
      }
    }
    // 名前付き参照
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named !== undefined ? named : whole;
  });
}

// ------------------------------------------------------------
// meta タグ抽出 (Deno に DOM が無いので regex)
// ------------------------------------------------------------
// <meta ...> タグを 1 つずつ取り出し、その属性から
// property/name と content を attribute 順不同で拾う。
function extractMetaContent(html: string, keys: readonly string[]): string | null {
  const wanted = new Set(keys.map((k) => k.toLowerCase()));
  const metaTagRe = /<meta\b[^>]*>/gi;
  let tag: RegExpExecArray | null;
  while ((tag = metaTagRe.exec(html)) !== null) {
    const attrs = tag[0];
    // property= または name= の値
    const keyMatch = attrs.match(/\b(?:property|name)\s*=\s*("([^"]*)"|'([^']*)'|([^\s">]+))/i);
    if (!keyMatch) continue;
    const key = (keyMatch[2] ?? keyMatch[3] ?? keyMatch[4] ?? '').trim().toLowerCase();
    if (!wanted.has(key)) continue;
    // content= の値 (同タグ内、順不同)
    const contentMatch = attrs.match(/\bcontent\s*=\s*("([^"]*)"|'([^']*)'|([^\s">]+))/i);
    if (!contentMatch) continue;
    const content = contentMatch[2] ?? contentMatch[3] ?? contentMatch[4] ?? '';
    const decoded = decodeEntities(content).trim();
    if (decoded) return decoded;
  }
  return null;
}

// <title>...</title> の抽出
function extractTitleTag(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m || m[1] === undefined) return null;
  const decoded = decodeEntities(m[1]).replace(/\s+/g, ' ').trim();
  return decoded || null;
}

// 相対 og:image を最終ページ URL で絶対化
function resolveImageUrl(image: string | null, baseUrl: string): string | null {
  if (!image) return null;
  try {
    return new URL(image, baseUrl).toString();
  } catch {
    return null;
  }
}

function truncate(value: string | null, max: number): string | null {
  if (value === null) return null;
  return value.length > max ? value.slice(0, max) : value;
}

// ------------------------------------------------------------
// レスポンス本文を最大 MAX_BODY_BYTES まで読み出す
// ------------------------------------------------------------
async function readCappedBody(res: Response): Promise<string> {
  if (!res.body) {
    const text = await res.text();
    return text.slice(0, MAX_BODY_BYTES);
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (received < MAX_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.length;
      }
    }
  } finally {
    // 上限到達時は残りを読まずに中断
    try {
      await reader.cancel();
    } catch {
      // cancel 失敗は無視
    }
  }
  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged).slice(0, MAX_BODY_BYTES);
}

// ------------------------------------------------------------
// ページを取得して OG メタを抽出
// ------------------------------------------------------------
async function fetchPreview(safeUrl: string): Promise<PreviewResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // ★ リダイレクトは手動で最大 MAX_REDIRECTS ホップ追跡し、各ホップで SSRF 再検証する
    //   (og-image の fetchImage と同パターン)。旧 'follow' は初回 URL しか検証せず、
    //   302 Location: http://169.254.169.254/... で内部 EP の HTML を取得できた (監査 S-4)。
    let currentUrl = safeUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
        },
      });

      const isRedirect =
        res.status === 0 ||
        res.type === 'opaqueredirect' ||
        (res.status >= 300 && res.status < 400);
      if (isRedirect) {
        const location = res.headers.get('location');
        try {
          await res.body?.cancel();
        } catch {
          // 無視
        }
        if (!location || hop >= MAX_REDIRECTS) return nullPreview(safeUrl);
        let nextUrl: string;
        try {
          nextUrl = new URL(location, currentUrl).toString();
        } catch {
          return nullPreview(safeUrl);
        }
        const safeNext = validateUrl(nextUrl);
        if (!safeNext) return nullPreview(safeUrl); // 内部 IP 等へのリダイレクトは拒否
        currentUrl = safeNext;
        continue;
      }

      if (!res.ok) return nullPreview(safeUrl);

      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.toLowerCase().includes('text/html')) {
        // HTML 以外 (画像 / PDF / JSON 等) は parse 対象外。本文は読まず破棄。
        try {
          await res.body?.cancel();
        } catch {
          // 無視
        }
        return nullPreview(safeUrl);
      }

      // 手動追跡なので最終 URL = currentUrl (相対 image 解決の base に使う)
      const finalUrl = currentUrl;
      const html = await readCappedBody(res);

    const title =
      extractMetaContent(html, ['og:title']) ??
      extractMetaContent(html, ['twitter:title']) ??
      extractTitleTag(html);

    const description =
      extractMetaContent(html, ['og:description']) ??
      extractMetaContent(html, ['twitter:description']) ??
      extractMetaContent(html, ['description']);

    const rawImage =
      extractMetaContent(html, ['og:image', 'og:image:url', 'og:image:secure_url']) ??
      extractMetaContent(html, ['twitter:image', 'twitter:image:src']);
    const image = resolveImageUrl(rawImage, finalUrl);

    const siteName =
      extractMetaContent(html, ['og:site_name']) ?? extractMetaContent(html, ['application-name']);

    return {
      url: safeUrl,
      title: truncate(title, MAX_TITLE),
      description: truncate(description, MAX_DESCRIPTION),
      image_url: truncate(image, MAX_IMAGE_URL),
      site_name: truncate(siteName, MAX_SITE_NAME),
      fetched_at: new Date().toISOString(),
    };
    }
    // 到達しない (ループ内の各分岐で return 済み) — 型と fail-secure の保険
    return nullPreview(safeUrl);
  } catch {
    // timeout / network error 等は fail-secure
    return nullPreview(safeUrl);
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------
// service_role で post_link_previews に upsert (RLS / rate-limit を迂回)
// ------------------------------------------------------------
async function cachePreview(preview: PreviewResult): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return;
  // メタが何も取れなかった場合は cache poisoning 防止で書き込まない
  if (!preview.title && !preview.image_url && !preview.description && !preview.site_name) {
    return;
  }
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
    await admin.from('post_link_previews').upsert(
      {
        url: preview.url,
        title: preview.title,
        description: preview.description,
        image_url: preview.image_url,
        site_name: preview.site_name,
        fetched_at: preview.fetched_at,
      },
      { onConflict: 'url' },
    );
  } catch {
    // DB 書き込み失敗はプレビュー返却を妨げない (best-effort cache)
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: buildCorsHeaders(req) });
  }

  // 入力 URL は catch 用に保持 (常に応答 shape に含める)
  let inputUrl = '';
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return jsonResponse(req, nullPreview(''), 200);
    }
    const rawUrl = (body as { url?: unknown }).url;
    if (typeof rawUrl !== 'string') {
      return jsonResponse(req, nullPreview(''), 200);
    }
    inputUrl = rawUrl;

    // SSRF ガード — 通らなければ fetch せず fail-secure
    const safeUrl = validateUrl(rawUrl);
    if (!safeUrl) {
      return jsonResponse(req, nullPreview(rawUrl), 200);
    }

    const preview = await fetchPreview(safeUrl);
    await cachePreview(preview);
    return jsonResponse(req, preview, 200);
  } catch {
    // 想定外エラーでも stack / secret を漏らさず null 応答
    return jsonResponse(req, nullPreview(inputUrl), 200);
  }
});
