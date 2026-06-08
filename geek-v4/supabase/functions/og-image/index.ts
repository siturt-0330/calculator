// ============================================================
// og-image: リンクプレビュー用 画像プロキシ (image proxy)
// ============================================================
// 入力: GET  og-image?url=<encoded な画像 URL>
// 動作:
//   1. SSRF ガード (og-fetch と同一ロジック) を通った http(s) URL のみ対象
//   2. GEEK サーバー (= この Edge Function) が画像を代理 fetch
//   3. content-type が画像ホワイトリストに合致し、サイズが上限内なら
//      画像バイト列をそのまま (強キャッシュ + CORS 付きで) 返す
//
// なぜ必要か (匿名 SNS のプライバシー):
//   <img src="https://外部ホスト/og.png"> をクライアントから直接読むと、
//   閲覧者の IP / UA / Referer が相手ホストに渡る。匿名性を売りにする本 SNS では
//   「誰がどの投稿(=どのリンク)を見たか」を外部に晒すことになる。
//   そこで Edge が代理取得し、クライアントは <img src=".../og-image?url=..."> と
//   GEEK ドメイン経由でだけ画像を読む。外部ホストには Edge の IP しか見えない。
//
// レスポンス:
//   - 成功: 画像バイト列 + 正しい content-type + Cache-Control: public,
//     max-age=604800, immutable (7 日, CDN/ブラウザで強くキャッシュ)
//   - 失敗/不正: fail-secure。エラー詳細は一切返さず 1x1 透明 PNG を 200 で返す
//     (短いキャッシュ)。クライアント側の <img> は「絵が出ない」だけで自然に壊れない。
//
// セキュリティ方針:
//   - SSRF 対策: private / loopback / link-local IP, localhost, *.local,
//     URL 内 credential (user:pass@) を拒否。拒否時は fetch せず透明 PNG。
//   - リダイレクトは手動で最大 MAX_REDIRECTS ホップに制限し、各ホップの
//     遷移先 URL も毎回 SSRF 再検証する (Location で内部 IP に飛ばす攻撃を防ぐ)。
//   - Cookie / Authorization は一切送らない (fetch の手動構築ヘッダのみ)。
//   - content-type は画像ホワイトリストのみ許可。それ以外は透明 PNG。
//   - サイズは content-length チェック + 読み取り上限の二段で ~5MB に制限
//     (画像爆弾 / メモリ枯渇対策)。
//   - 例外は全て catch し、never throw to client (stack / secret を漏らさない)。
//
//   ⚠️ deploy は **未認証で叩ける必要がある** (<img src> は Authorization
//      ヘッダを付けられないため)。よって JWT 検証を切って deploy する:
//
//        supabase functions deploy og-image --no-verify-jwt
//
//      (公開 GET。og-fetch 同様、deploy するまでは client 側の直 <img> /
//       microlink fallback が使われる。SSRF ガードがあるので未認証公開でも
//       「任意 URL を読ませる踏み台」にはならない設計。)
// ============================================================

import { buildCorsHeaders } from '../_shared/cors.ts';

// ------------------------------------------------------------
// 上限値 / 定数
// ------------------------------------------------------------
const FETCH_TIMEOUT_MS = 6000; // 1 リクエスト全体 (リダイレクト含む) のタイムアウト
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_REDIRECTS = 3; // 追跡する最大リダイレクトホップ数
// 一般的なブラウザ風 UA。GeekBot だと弾く CDN があるため画像取得は普通の UA に寄せる。
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// 許可する画像 content-type (前方一致で判定。charset 等のパラメータは無視)。
const ALLOWED_IMAGE_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/jpg', // 一部サーバーが返す非標準表記も許容
  'image/gif',
  'image/webp',
  'image/avif',
];

// 1x1 透明 PNG (fail-secure 応答用)。base64 をデコードしてバイト列にしておく。
const TRANSPARENT_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const TRANSPARENT_PNG = decodeBase64(TRANSPARENT_PNG_BASE64);

// ------------------------------------------------------------
// SSRF ガード — og-fetch/index.ts と同一ロジック (private / loopback /
// link-local を全て拒否)。攻撃者が画像 URL に内部アドレスを渡しても、
// Edge ランタイム権限で内部サービスやメタデータ EP (169.254.169.254)
// へ到達させない。fail-secure。
// ------------------------------------------------------------

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
// 画像レスポンス用ヘッダ (CORS は _shared から流用)。
// _shared/cors.ts の buildCorsHeaders は Allow-Methods に POST,OPTIONS を
// 出すが、<img> GET は simple request で preflight が走らないため実害なし。
// OPTIONS preflight 用に Allow-Methods へ GET を足したヘッダを別途用意する。
// ------------------------------------------------------------
function corsHeaders(req: Request): Record<string, string> {
  return buildCorsHeaders(req);
}

// 成功時: 画像バイト列を強キャッシュで返す
function imageResponse(req: Request, body: Uint8Array, contentType: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      ...corsHeaders(req),
      'Content-Type': contentType,
      // 画像は事実上不変。CDN / ブラウザに 7 日間強キャッシュさせる。
      'Cache-Control': 'public, max-age=604800, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

// fail-secure: 1x1 透明 PNG を 200 で返す (短いキャッシュ)。
// エラー理由は一切返さない。クライアントの <img> は「透明 = 絵なし」で自然に処理。
function transparentResponse(req: Request): Response {
  return new Response(TRANSPARENT_PNG, {
    status: 200,
    headers: {
      ...corsHeaders(req),
      'Content-Type': 'image/png',
      // 失敗応答は長くキャッシュしない (一時障害なら後でちゃんと取れるように)。
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

// content-type ヘッダが画像ホワイトリストに合致するか
function isAllowedImageType(contentType: string | null): boolean {
  if (!contentType) return false;
  // "image/png; charset=..." のようなパラメータを落として前方一致で比較。
  const base = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return ALLOWED_IMAGE_TYPES.includes(base);
}

// 正規化後の content-type (パラメータ除去)。jpg → jpeg に寄せる。
function normalizeContentType(contentType: string): string {
  const base = contentType.split(';')[0]?.trim().toLowerCase() ?? 'image/png';
  return base === 'image/jpg' ? 'image/jpeg' : base;
}

// ------------------------------------------------------------
// レスポンス本文を最大 MAX_IMAGE_BYTES まで読み出す。
// 上限を 1 byte でも超えたら画像爆弾とみなし null (= fail-secure)。
// ------------------------------------------------------------
async function readCappedImage(res: Response): Promise<Uint8Array | null> {
  if (!res.body) {
    // body stream が無いケース (HEAD 等)。arrayBuffer で読んで上限チェック。
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.length > MAX_IMAGE_BYTES ? null : buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let overLimit = false;
  try {
    // eslint-disable-next-line no-constant-condition -- ストリームを done まで読み切るループ
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        received += value.length;
        if (received > MAX_IMAGE_BYTES) {
          // 上限超過: 残りは読まずに中断し、fail-secure 扱い。
          overLimit = true;
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
  if (overLimit) return null;

  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

// ------------------------------------------------------------
// 画像を代理取得する。リダイレクトは手動で最大 MAX_REDIRECTS ホップ追跡し、
// 各ホップで遷移先 URL を SSRF 再検証する。
// 戻り値: { body, contentType } or null (= fail-secure)。
// ------------------------------------------------------------
async function fetchImage(
  startUrl: string,
): Promise<{ body: Uint8Array; contentType: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let currentUrl = startUrl;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await fetch(currentUrl, {
        method: 'GET',
        // 手動でリダイレクトを処理し、各ホップのホストを再検証する。
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,*/*;q=0.8',
          // Cookie / Authorization は意図的に付けない (資格情報を相手へ渡さない)。
        },
      });

      // リダイレクト (3xx + Location)。'manual' では status 0 の opaqueredirect に
      // なる場合があるため、status と Location ヘッダの両面で判定する。
      const isRedirect =
        res.status === 0 ||
        res.type === 'opaqueredirect' ||
        (res.status >= 300 && res.status < 400);

      if (isRedirect) {
        const location = res.headers.get('location');
        // body は読まずに破棄
        try {
          await res.body?.cancel();
        } catch {
          // 無視
        }
        // Location 無し / ホップ上限到達なら追跡終了 (fail-secure)。
        if (!location || hop >= MAX_REDIRECTS) return null;

        // 相対 Location を現在 URL で絶対化し、改めて SSRF 検証する。
        let nextUrl: string;
        try {
          nextUrl = new URL(location, currentUrl).toString();
        } catch {
          return null;
        }
        const safeNext = validateUrl(nextUrl);
        if (!safeNext) return null; // 内部 IP 等へのリダイレクトは拒否
        currentUrl = safeNext;
        continue;
      }

      // 2xx 以外 (4xx/5xx 等) は失敗。
      if (!res.ok) {
        try {
          await res.body?.cancel();
        } catch {
          // 無視
        }
        return null;
      }

      // content-type が画像でなければ拒否 (HTML/JSON/SVG 等を画像として返さない)。
      const contentType = res.headers.get('content-type');
      if (!isAllowedImageType(contentType)) {
        try {
          await res.body?.cancel();
        } catch {
          // 無視
        }
        return null;
      }

      // content-length が宣言されていて上限超過なら、読む前に拒否 (早期 fail)。
      const lenHeader = res.headers.get('content-length');
      if (lenHeader) {
        const declared = Number(lenHeader);
        if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
          try {
            await res.body?.cancel();
          } catch {
            // 無視
          }
          return null;
        }
      }

      // 実バイト列を上限付きで読む (content-length 詐称 / chunked への保険)。
      const body = await readCappedImage(res);
      if (!body || body.length === 0) return null;

      return { body, contentType: normalizeContentType(contentType as string) };
    }

    return null; // ループを抜けた = リダイレクト過多
  } catch {
    // timeout / network error 等は fail-secure
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------
// エントリポイント
// ------------------------------------------------------------
Deno.serve(async (req) => {
  // CORS preflight。<img> GET は preflight 不要だが fetch() 経由のケースに備える。
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        ...corsHeaders(req),
        // 本関数は GET のみ。_shared の POST,OPTIONS を GET,OPTIONS に上書き。
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      },
    });
  }

  // GET 以外は受けない (ただし詳細は返さず透明 PNG)。
  if (req.method !== 'GET') {
    return transparentResponse(req);
  }

  try {
    const rawUrl = new URL(req.url).searchParams.get('url');
    if (!rawUrl) return transparentResponse(req);

    // SSRF ガード — 通らなければ fetch せず fail-secure。
    const safeUrl = validateUrl(rawUrl);
    if (!safeUrl) return transparentResponse(req);

    const result = await fetchImage(safeUrl);
    if (!result) return transparentResponse(req);

    return imageResponse(req, result.body, result.contentType);
  } catch {
    // 想定外エラーでも stack / secret を漏らさず透明 PNG。
    return transparentResponse(req);
  }
});
