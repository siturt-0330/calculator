// ============================================================
// _shared/cors.ts — CORS allowlist + 共通 fail-secure ヘルパ
// ============================================================
// 全 Edge Function で共通利用。Origin allowlist 方式で `*` を廃止。
// preview / staging 用ドメインを増やす時はここを更新するだけで OK。
//
// 開発時 (localhost) は許可、production は geekboard.netlify.app + geek.app 系。
// ★ 実本番 web は geekboard.netlify.app。ここに無いと check-content が本番で
//   CORS ブロック → クライアントの catch が fail-open し moderation が silent no-op、
//   og-fetch も microlink fallback に落ちる (2026-06 監査 S-6)。
// ============================================================

const STATIC_ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  'https://geekboard.netlify.app', // ★ 実本番 (Netlify)
  'https://geek.app',
  'https://www.geek.app',
  'https://admin.geek.app',
  'https://preview.geek.app',
  // 開発用
  'http://localhost:8081',   // Expo Web dev (default)
  'http://localhost:19006',  // Expo Web (legacy default)
  'http://localhost:3000',
  'http://127.0.0.1:8081',
  'http://127.0.0.1:19006',
  'http://127.0.0.1:3000',
]);

// *.geek.app は許可 (preview deploy 等)
const ALLOWED_HOST_SUFFIX = /^https:\/\/[a-z0-9-]+\.geek\.app$/i;
// Netlify の deploy-preview (deploy-preview-123--geekboard.netlify.app) は限定許可。
// ★ *.netlify.app 全許可は不可 (他人のサイトも乗るため geekboard サブドメインに限定)。
const ALLOWED_NETLIFY_PREVIEW = /^https:\/\/[a-z0-9-]+--geekboard\.netlify\.app$/i;

function isOriginAllowed(origin: string): boolean {
  if (!origin) return false;
  if (STATIC_ALLOWED_ORIGINS.has(origin)) return true;
  if (ALLOWED_HOST_SUFFIX.test(origin)) return true;
  if (ALLOWED_NETLIFY_PREVIEW.test(origin)) return true;
  return false;
}

/**
 * Origin allowlist に基づく CORS ヘッダを生成する。
 * 許可されないオリジンは production ドメインを返す
 * (ブラウザ側で CORS error として弾かれる)。
 */
export function buildCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allowed = isOriginAllowed(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? origin : 'https://geek.app',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '3600',
    Vary: 'Origin',
  };
}

/**
 * 安全な JSON レスポンス生成 (production では詳細エラーを返さない)。
 */
export function jsonResponse(
  req: Request,
  body: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...buildCorsHeaders(req),
      'Content-Type': 'application/json',
    },
  });
}

/**
 * production 環境かどうか (DENO_ENV / SUPABASE_PROJECT_REF で判定)。
 * 詳細エラーメッセージを返してよいかの判定に使う。
 */
export function isProduction(): boolean {
  const env = Deno.env.get('DENO_ENV') ?? Deno.env.get('NODE_ENV') ?? '';
  return env === 'production' || !!Deno.env.get('SUPABASE_PROJECT_REF');
}
