// ============================================================
// Resilient: retry + timeout + breadcrumb で API 呼び出しを堅牢化
// ============================================================
// 使い方:
//   const result = await resilient(() => supabase.from('posts').select(...), {
//     name: 'posts.fetch',
//     timeoutMs: 8000,
//     retries: 2,
//   });
//
// 透明なリトライ:
//   - ネットワークエラー / タイムアウト / 503 系のみ再試行
//   - 指数バックオフ (200ms → 400ms → 800ms)
//   - 認証エラー (401/403) や RLS 違反は再試行しない (即fail)
// ============================================================

export type ResilientOptions = {
  name: string;            // ログ/Sentry 用ラベル
  timeoutMs?: number;      // 個別呼び出しのタイムアウト (default 10s)
  retries?: number;        // 最大リトライ回数 (default 2)
  baseBackoffMs?: number;  // バックオフの初期値 (default 200)
  silent?: boolean;        // 成功ログを抑制
};

const SHOULD_RETRY_MESSAGE_PARTS = [
  'Failed to fetch',
  'NetworkError',
  'network request failed',
  'timeout',
  'Timeout',
  '503',
  '502',
  '504',
  'ETIMEDOUT',
  'ECONNRESET',
];

const NO_RETRY_MESSAGE_PARTS = [
  '401',
  '403',
  'row-level security',
  'RLS',
  'duplicate key',
  'check constraint',
];

function shouldRetry(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (NO_RETRY_MESSAGE_PARTS.some((p) => msg.includes(p))) return false;
  if (SHOULD_RETRY_MESSAGE_PARTS.some((p) => msg.includes(p))) return true;
  // デフォルトでは予期せぬエラーは1度だけリトライ
  return true;
}

// 401 検知用 — auth token が無効になった時に signOut を発火するヘルパ
// authStore 側で setUnauthorizedHandler() を呼んで登録する
let unauthorizedHandler: (() => Promise<void> | void) | null = null;
export function setUnauthorizedHandler(fn: (() => Promise<void> | void) | null) {
  unauthorizedHandler = fn;
}

function looksLikeUnauthorized(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return msg.includes('401') || msg.includes('JWT expired') || msg.toLowerCase().includes('unauthorized');
}

async function maybeTriggerUnauthorized(err: unknown) {
  if (!looksLikeUnauthorized(err)) return;
  if (!unauthorizedHandler) return;
  try {
    await unauthorizedHandler();
  } catch (e) {
    console.warn('[resilient] unauthorized handler error:', e);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 軽量 Sentry breadcrumb (loaded lazily, fails silently)
function breadcrumb(category: string, message: string, level: 'info' | 'warning' | 'error' = 'info', data?: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  try {
    // @ts-ignore - Sentry がロードされてれば使う、なければ無視
    const Sentry = (globalThis as { Sentry?: { addBreadcrumb?: (b: unknown) => void } }).Sentry;
    if (Sentry?.addBreadcrumb) {
      Sentry.addBreadcrumb({ category, message, level, data, timestamp: Date.now() / 1000 });
    }
  } catch {}
}

export async function resilient<T>(
  fn: () => Promise<T>,
  options: ResilientOptions,
): Promise<T> {
  const {
    name,
    timeoutMs = 10000,
    retries = 2,
    baseBackoffMs = 200,
    silent = true,
  } = options;

  let attempt = 0;
  let lastError: unknown;
  const start = Date.now();

  while (attempt <= retries) {
    attempt += 1;
    try {
      const value = await Promise.race<T>([
        fn(),
        new Promise<T>((_, reject) => {
          setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
      const elapsed = Date.now() - start;
      if (!silent) breadcrumb('resilient', `${name} ok (${attempt} try, ${elapsed}ms)`, 'info');
      return value;
    } catch (err) {
      lastError = err;
      const can = shouldRetry(err);
      const msg = err instanceof Error ? err.message : String(err ?? '');
      breadcrumb('resilient', `${name} fail (try ${attempt}): ${msg}`, can && attempt <= retries ? 'warning' : 'error');
      if (!can || attempt > retries) break;
      const backoff = baseBackoffMs * Math.pow(2, attempt - 1);
      await sleep(backoff);
    }
  }
  // 最終失敗が 401/JWT expired なら signOut を発火 (1 回だけ; ハンドラ側で
  // 二重 signOut を防いでいる)
  void maybeTriggerUnauthorized(lastError);
  throw lastError;
}

// 並列で全部成功する必要がある場合: Promise.all のリジリエント版
export async function resilientAll<T>(
  fns: Array<{ fn: () => Promise<T>; name: string }>,
  base: Omit<ResilientOptions, 'name'> = {},
): Promise<T[]> {
  return Promise.all(fns.map(({ fn, name }) => resilient(fn, { ...base, name })));
}
