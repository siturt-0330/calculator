import { ENV } from './env';

// Sensitive substrings — error message に出てきたら redact する
const SENSITIVE_PATTERNS: RegExp[] = [
  /bearer\s+[a-z0-9._-]+/gi,                            // JWT bearer token
  /eyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+/gi,         // raw JWT
  /[\w.+-]+@[\w-]+\.[\w.-]+/g,                          // email
  /(?<!\d)\d{10,15}(?!\d)/g,                            // phone (10-15 digits)
  /password['"\s:=]+[\S]+/gi,                           // password=...
  /access_?token['"\s:=]+[\S]+/gi,
  /refresh_?token['"\s:=]+[\S]+/gi,
];

function redact(s: string): string {
  let out = s;
  for (const re of SENSITIVE_PATTERNS) out = out.replace(re, '[REDACTED]');
  return out;
}

function redactObject<T>(v: T): T {
  if (typeof v === 'string') return redact(v) as unknown as T;
  if (Array.isArray(v)) return v.map(redactObject) as unknown as T;
  if (v && typeof v === 'object') {
    const obj: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) obj[k] = redactObject(val);
    return obj as unknown as T;
  }
  return v;
}

// Sentry は production 専用 + DSN がセットされている時しか初期化しない。
// `@sentry/react-native` 本体 (数百KB) が initial bundle に乗らないよう、
// require() を関数内に閉じ込めて bundler に副作用なし import を伝える。
// (top-level の `import * as Sentry from '@sentry/react-native'` だと
//  実際に init を呼ばなくてもバンドルに含まれてしまう。)
export function initSentry() {
  if (!ENV.SENTRY_DSN) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require('@sentry/react-native') as typeof import('@sentry/react-native');
    // ErrorBoundary / resilient breadcrumb は globalThis.Sentry を遅延参照する
    // ので init 完了後に晒しておく (lib/resilient.ts, components/ui/ErrorBoundary.tsx)
    (globalThis as { Sentry?: typeof Sentry }).Sentry = Sentry;
    Sentry.init({
      dsn: ENV.SENTRY_DSN,
      environment: ENV.IS_DEV ? 'development' : 'production',
      // PII / token を Sentry に流出させないよう sample rate を絞る + scrub
      tracesSampleRate: 0.05,
      sendDefaultPii: false,
      // console.log / console.warn 経由の PII リークを防ぐ:
      // 既定の Breadcrumbs integration を削除し、error/warning レベルだけ取る
      // カスタム設定で再挿入する。Sentry SDK のバージョン差を吸収するため
      // try/catch で defensive に。
      // 型は Sentry SDK の Integration[] だが、SDK バージョン差を吸収するため
      // 内部では緩い型で扱い、最後に unknown 経由で戻す。
      integrations: (defaultIntegrations) => {
        try {
          const list = defaultIntegrations as unknown as { name?: string }[];
          const filtered = list.filter(
            (i) => i?.name !== 'Breadcrumbs' && i?.name !== 'ReactNativeBreadcrumbs',
          );
          const SentryAny = Sentry as unknown as {
            breadcrumbsIntegration?: (opts: unknown) => unknown;
            Breadcrumbs?: new (opts: unknown) => unknown;
          };
          // console: false で console.* を breadcrumb として取らない
          const opts = { console: false, dom: false, fetch: true, history: true, xhr: true };
          const factory = SentryAny.breadcrumbsIntegration;
          if (typeof factory === 'function') {
            filtered.push(factory(opts) as { name?: string });
          } else if (SentryAny.Breadcrumbs) {
            filtered.push(new SentryAny.Breadcrumbs(opts) as { name?: string });
          }
          return filtered as unknown as typeof defaultIntegrations;
        } catch {
          // 失敗しても最低限 default の動作は保つ
          return defaultIntegrations;
        }
      },
      beforeSend(event) {
        try {
          if (event.message) event.message = redact(event.message);
          if (event.exception?.values) {
            for (const ex of event.exception.values) {
              if (ex.value) ex.value = redact(ex.value);
            }
          }
          if (event.breadcrumbs) {
            for (const bc of event.breadcrumbs) {
              if (bc.message) bc.message = redact(bc.message);
              if (bc.data) bc.data = redactObject(bc.data);
            }
          }
          if (event.request?.url) event.request.url = redact(event.request.url);
          // user の email / phone / username を Sentry に送らない
          if (event.user) {
            const { id } = event.user;
            event.user = id ? { id } : undefined;
          }
        } catch {}
        return event;
      },
    });
  } catch {
    // Sentry 未インストールでも本体が止まらないように
  }
}
