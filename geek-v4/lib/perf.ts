// ============================================================
// lib/perf.ts — ロード性能メトリクスを実際の sink に流す唯一の出口
// ------------------------------------------------------------
// PostHog 撤去で analytics.track() が no-op になり、lib/webVitals.ts が計測した
// Web Vitals (LCP/FCP/CLS/TTFB/FID) が「計算するだけでどこにも届かない」状態だった。
// ここに一本化して、改善の効果を実測できる土台を作る。
//
// 研究知見 (FB iOS / Core Web Vitals): 「計測は全ての最適化の前提」。LCP<2.5s 等の
// budget で good / needs-improvement / poor を判定し、poor を可視化する。
//
// 送信先:
//   - dev (__DEV__) : console.log で全件 (開発時の確認用)
//   - prod          : Sentry breadcrumb で全件 (error 発生時に文脈として付く)
//                     + poor のみ captureMessage で独立イベント化 (回帰検知用・間引き)
//   ※ prod の console は babel transform-remove-console で error/warn 以外 strip される。
//     poor のときだけ console.warn で残し、DevTools で素読みできるようにする。
//   ※ Sentry は production + DSN 設定時のみ globalThis.Sentry に居る (lib/sentry.ts)。
//     未 init のときは breadcrumb/capture を skip (= 何も壊さない)。
// ============================================================
import { Platform } from 'react-native';

export type PerfRating = 'good' | 'needs-improvement' | 'poor';

type SentryLike = {
  addBreadcrumb?: (b: unknown) => void;
  captureMessage?: (msg: string, ctx?: unknown) => void;
};
function getSentry(): SentryLike | undefined {
  return (globalThis as { Sentry?: SentryLike }).Sentry;
}
function isDev(): boolean {
  return !!(globalThis as { __DEV__?: boolean }).__DEV__;
}

// poor を独立イベント化する際の間引き (Sentry の Issue volume を抑える)。n 件に 1 件。
let poorCaptureCounter = 0;
const POOR_CAPTURE_EVERY = 2;

/**
 * ロード性能の 1 メトリクスを記録する。webVitals / startup マークから呼ばれる唯一の出口。
 * @param name   例 'LCP' / 'startup.feed_first_content'
 * @param value  ミリ秒 (CLS は無次元)
 * @param rating budget 判定済みの good/needs-improvement/poor
 */
export function reportPerf(
  name: string,
  value: number,
  rating: PerfRating,
  extra?: Record<string, unknown>,
): void {
  const rounded = Math.round(value * 1000) / 1000;
  const path = typeof window !== 'undefined' ? window.location?.pathname : undefined;

  if (isDev()) {
    console.log(`[perf] ${name}=${rounded} (${rating})`, extra ?? '');
  } else if (rating === 'poor') {
    console.warn(`[perf] ${name}=${rounded} (poor)`);
  }

  const Sentry = getSentry();
  if (!Sentry) return;
  try {
    Sentry.addBreadcrumb?.({
      category: 'perf',
      type: 'info',
      level: rating === 'poor' ? 'warning' : 'info',
      message: `${name}=${rounded} (${rating})`,
      data: { name, value: rounded, rating, platform: Platform.OS, path, ...extra },
    });
    if (rating === 'poor') {
      poorCaptureCounter += 1;
      if (poorCaptureCounter % POOR_CAPTURE_EVERY === 0) {
        Sentry.captureMessage?.(`[perf] ${name} poor (${rounded})`, {
          level: 'warning',
          tags: { perf_metric: name, perf_rating: rating, platform: Platform.OS },
          extra: { value: rounded, path, ...extra },
        });
      }
    }
  } catch {
    /* 計測が本体を壊さないよう握りつぶす (breadcrumb/capture の失敗は無視) */
  }
}

// ------------------------------------------------------------
// 起動メトリクス (cross-platform)
// ------------------------------------------------------------
// Web Vitals は web 専用なので、native でも測れる「app JS 初期化 → 使える状態」の
// 相対時間を 1 度だけ記録する。
// ※ APP_JS_START は perf module の初回 import 時刻であり true な process 起動ではない。
//   絶対 TTI ではないが、同一指標として before/after 比較に使える (native の唯一の起動シグナル)。
const APP_JS_START = Date.now();
const startupMarked = new Set<string>();

/** 起動系の一度きりマーク。例: feed 初コンテンツ表示 = markStartupOnce('feed_first_content')。 */
export function markStartupOnce(label: string): void {
  if (startupMarked.has(label)) return;
  startupMarked.add(label);
  const elapsed = Date.now() - APP_JS_START;
  // budget: FB の「<2.5s TTFD or bad start」を流用 (perf 調査レポート参照)。
  const rating: PerfRating =
    elapsed <= 2500 ? 'good' : elapsed <= 4000 ? 'needs-improvement' : 'poor';
  reportPerf(`startup.${label}`, elapsed, rating);
}
