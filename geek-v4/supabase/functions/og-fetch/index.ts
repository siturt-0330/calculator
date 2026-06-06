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
import { assertHostResolvesToPublic, signImageUrl, validateUrl } from '../_shared/ssrf.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
// og-image プロキシ署名用 secret (og-image 側=検証 と同一)。未設定なら画像は
// proxy せず null (fail-secure: raw 画像 URL を閲覧者に晒さない)。
//   有効化: supabase secrets set OG_IMAGE_PROXY_SECRET=<32+byte hex>
const OG_IMAGE_PROXY_SECRET = Deno.env.get('OG_IMAGE_PROXY_SECRET') ?? '';

// fetch の上限値
const FETCH_TIMEOUT_MS = 6000;
const MAX_BODY_BYTES = 512 * 1024; // 512KB
const MAX_REDIRECTS = 4; // リダイレクト追従の上限 (og-image と同値)
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
// SSRF ガード — 判定ロジックは _shared/ssrf.ts に集約 (og-image と共有)。
// ------------------------------------------------------------
// 攻撃者が og-fetch に内部 URL を渡すと、Edge ランタイムの権限で
// メタデータエンドポイント (169.254.169.254) や内部サービスへ到達できる。
// よって「外部の公開ホスト」以外は fetch する前に弾く (fail-secure)。多層で防ぐ:
//   1. validateUrl: http(s) / credential / private / loopback / link-local /
//      CGNAT / multicast / IPv6(-mapped) を静的に一括判定。
//   2. assertHostResolvesToPublic: 対象ホストを DNS 解決し、解決後 IP も分類
//      (名前→内部 IP / DNS rebinding の入口を塞ぐ)。
//   3. redirect:'manual' + 各 hop で 1.2. を再適用 (リダイレクト経由の bypass 防止)。
// ※ 旧 isBlockedIpv4/isBlockedIpv6/isBlockedHostname/validateUrl のローカル定義は
//   _shared/ssrf.ts に移管・統合済 (shared 版は multicast/CGNAT/IPv4-mapped-hex を
//   追加でブロックする strict superset。正規 URL への挙動は不変)。

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
// SSRF を通った URL を redirect:'manual' で fetch。
// 3xx は Location を各 hop 再検証 (validateUrl + DNS 解決分類) してから
// MAX_REDIRECTS まで追従する。これで「正常 URL → 302 で内部 IP」という
// リダイレクト経由の SSRF bypass を塞ぐ (og-image と同型)。
// 戻り値: { res(body 未読), finalUrl } / 拒否・上限・Location 欠落で null。
// ------------------------------------------------------------
async function fetchFollowingRedirects(
  startUrl: string,
  signal: AbortSignal,
): Promise<{ res: Response; finalUrl: string } | null> {
  let currentUrl = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(currentUrl, {
      method: 'GET',
      redirect: 'manual', // 各 hop を自前で再検証する (自動追従させない)
      signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    const status = res.status;
    // 3xx + Location → リダイレクト。各 hop で再 SSRF 検証してから追従。
    if (status >= 300 && status < 400) {
      const location = res.headers.get('location');
      try {
        await res.body?.cancel(); // body は捨てる
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
      // DNS rebinding 対策: 解決後 IP が内部なら拒否 (null=解決不能は許容=fail-open)
      const dnsOk = await assertHostResolvesToPublic(new URL(safeNext).hostname);
      if (dnsOk === false) return null;
      currentUrl = safeNext;
      continue;
    }

    // 非 3xx はここで確定 (最終 URL も相対 image 解決用に返す)
    return { res, finalUrl: res.url || currentUrl };
  }
  return null;
}

// ------------------------------------------------------------
// ページを取得して OG メタを抽出
// ------------------------------------------------------------
async function fetchPreview(safeUrl: string): Promise<PreviewResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // DNS rebinding 対策 (初回ホスト): 静的 validateUrl は通っていても
    // 名前が内部 IP に解決されるなら fetch しない。null=解決不能は fail-open
    // (可用性優先。静的検証は既に通過済み)。
    const dnsOk = await assertHostResolvesToPublic(new URL(safeUrl).hostname);
    if (dnsOk === false) return nullPreview(safeUrl);

    const fetched = await fetchFollowingRedirects(safeUrl, controller.signal);
    if (!fetched || !fetched.res.ok) {
      // 3xx 上限/拒否、または非 2xx 最終応答は本文を読まず破棄して fail-secure
      try {
        await fetched?.res.body?.cancel();
      } catch {
        // 無視
      }
      return nullPreview(safeUrl);
    }
    const res = fetched.res;

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

    // リダイレクト後の最終 URL (相対 image 解決の base に使う)
    const finalUrl = fetched.finalUrl || safeUrl;
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
    const absImage = resolveImageUrl(rawImage, finalUrl);
    // ★ og:image を og-image プロキシの署名つき URL に変換する (閲覧者IP漏れ防止)。
    //   secret 未設定 / SSRF NG / 長すぎ は null = 画像なし (raw URL は閲覧者に晒さない)。
    const image = await signImageUrl(absImage, OG_IMAGE_PROXY_SECRET, SUPABASE_URL);

    const siteName =
      extractMetaContent(html, ['og:site_name']) ?? extractMetaContent(html, ['application-name']);

    return {
      url: safeUrl,
      title: truncate(title, MAX_TITLE),
      description: truncate(description, MAX_DESCRIPTION),
      image_url: image, // og-image 署名 proxy URL (≤2048) or null。署名を切らないため truncate しない。
      site_name: truncate(siteName, MAX_SITE_NAME),
      fetched_at: new Date().toISOString(),
    };
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
