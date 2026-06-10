import { Platform } from 'react-native';
import { reportPerf } from './perf';

// ============================================================
// Web Vitals (Google Core Web Vitals) + custom events
// ============================================================
// 計測する指標:
//   - LCP (Largest Contentful Paint): 主要コンテンツ表示までの時間。良い: ≤ 2.5s
//   - INP (Interaction to Next Paint): 操作→次描画。良い: ≤ 200ms (2024 から FID の後継・正式指標)
//   - FID (First Input Delay): 初回入力遅延。良い: ≤ 100ms (INP に置換された旧指標だが互換で併設)
//   - CLS (Cumulative Layout Shift): レイアウトずれの累積。良い: ≤ 0.1
//   - FCP (First Contentful Paint): 初回描画。良い: ≤ 1.8s
//   - TTFB (Time to First Byte): サーバー応答。良い: ≤ 800ms
//
// 実装: web-vitals ライブラリではなく、ブラウザ標準 PerformanceObserver を使う
//   - 依存ゼロ・バンドル無し
//   - INP は event timing で「最も遅かったインタラクション」を近似 (CLS と同じく hidden 時 flush)。
//     正確な INP は高パーセンタイルだが、依存を増やさず操作の重さを捕捉するのが目的。
//
// 送信先: lib/perf.ts の reportPerf (dev=console / prod=Sentry breadcrumb + poor は captureMessage)
// ============================================================

type Metric = {
  name: 'LCP' | 'INP' | 'FID' | 'CLS' | 'FCP' | 'TTFB';
  value: number;
  rating: 'good' | 'needs-improvement' | 'poor';
};

const THRESHOLDS: Record<Metric['name'], [number, number]> = {
  LCP: [2500, 4000],
  INP: [200, 500],
  FID: [100, 300],
  CLS: [0.1, 0.25],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
};

function rate(name: Metric['name'], v: number): Metric['rating'] {
  const [good, ni] = THRESHOLDS[name];
  if (v <= good) return 'good';
  if (v <= ni) return 'needs-improvement';
  return 'poor';
}

function report(name: Metric['name'], value: number) {
  const m: Metric = { name, value, rating: rate(name, value) };
  // PostHog 撤去後の no-op track() ではなく lib/perf.ts に流す
  // (dev=console / prod=Sentry breadcrumb + poor は captureMessage)。
  reportPerf(m.name, m.value, m.rating, {
    url: typeof window !== 'undefined' ? window.location.pathname : '',
  });
}

// 重複送信を防ぐ
const reported = new Set<Metric['name']>();
function reportOnce(name: Metric['name'], value: number) {
  if (reported.has(name)) return;
  reported.add(name);
  report(name, value);
}

export function initWebVitals(): () => void {
  if (Platform.OS !== 'web') return () => {};
  if (typeof PerformanceObserver === 'undefined') return () => {};
  if (typeof window === 'undefined' || typeof performance === 'undefined') return () => {};

  const observers: PerformanceObserver[] = [];
  const cleanupCallbacks: Array<() => void> = [];

  // ---- LCP ----
  try {
    const lcpObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries() as PerformanceEntry[];
      const last = entries[entries.length - 1];
      if (last) reportOnce('LCP', last.startTime);
    });
    lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
    observers.push(lcpObserver);
  } catch { /* PerformanceObserver 未対応ブラウザ */ }

  // ---- FID ----
  try {
    const fidObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as PerformanceEntry[]) {
        const e = entry as PerformanceEntry & { processingStart?: number };
        if (e.processingStart !== undefined) {
          reportOnce('FID', e.processingStart - e.startTime);
        }
      }
    });
    fidObserver.observe({ type: 'first-input', buffered: true });
    observers.push(fidObserver);
  } catch { /* PerformanceObserver 未対応ブラウザ */ }

  // ---- INP (Interaction to Next Paint) の近似 — 最も遅いインタラクションを hidden 時に flush ----
  let inpValue = 0;
  let inpReported = false;
  try {
    const inpObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as PerformanceEntry[]) {
        // event timing の duration ≈ 入力から次 paint までの概算。最大値を近似 INP とする。
        if (entry.duration > inpValue) inpValue = entry.duration;
      }
    });
    // durationThreshold は型に無いブラウザ拡張プロパティなので init を緩く cast。
    // 40ms 以上のインタラクションだけ通知してノイズを間引く。
    inpObserver.observe({
      type: 'event',
      durationThreshold: 40,
      buffered: true,
    } as PerformanceObserverInit);
    observers.push(inpObserver);

    const flushInp = () => {
      if (inpReported || inpValue <= 0) return;
      inpReported = true;
      reportOnce('INP', inpValue);
    };
    const onInpVis = () => { if (document.visibilityState === 'hidden') flushInp(); };
    window.addEventListener('visibilitychange', onInpVis);
    window.addEventListener('pagehide', flushInp);
    cleanupCallbacks.push(() => {
      window.removeEventListener('visibilitychange', onInpVis);
      window.removeEventListener('pagehide', flushInp);
    });
  } catch { /* event timing 未対応ブラウザ */ }

  // ---- CLS (累積なので unload まで監視) ----
  let clsValue = 0;
  let clsReported = false;
  try {
    const clsObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as PerformanceEntry[]) {
        const e = entry as PerformanceEntry & { value?: number; hadRecentInput?: boolean };
        // ユーザー操作直後のレイアウトずれは除外
        if (!e.hadRecentInput && typeof e.value === 'number') {
          clsValue += e.value;
        }
      }
    });
    clsObserver.observe({ type: 'layout-shift', buffered: true });
    observers.push(clsObserver);

    const flushCls = () => {
      if (clsReported) return;
      clsReported = true;
      reportOnce('CLS', clsValue);
    };
    const onVis = () => { if (document.visibilityState === 'hidden') flushCls(); };
    window.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', flushCls);
    // cleanup 用に保存しておく
    cleanupCallbacks.push(() => {
      window.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', flushCls);
    });
  } catch { /* PerformanceObserver 未対応ブラウザ */ }

  // ---- FCP ----
  try {
    const fcpObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as PerformanceEntry[]) {
        if (entry.name === 'first-contentful-paint') {
          reportOnce('FCP', entry.startTime);
        }
      }
    });
    fcpObserver.observe({ type: 'paint', buffered: true });
    observers.push(fcpObserver);
  } catch { /* PerformanceObserver 未対応ブラウザ */ }

  // ---- TTFB ----
  try {
    const nav = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    const entry = nav[0];
    if (entry) {
      reportOnce('TTFB', Math.max(0, entry.responseStart - entry.startTime));
    }
  } catch { /* getEntriesByType 未対応ブラウザ */ }

  return () => {
    for (const o of observers) {
      try { o.disconnect(); } catch { /* ignore */ }
    }
    for (const c of cleanupCallbacks) {
      try { c(); } catch { /* ignore */ }
    }
  };
}
