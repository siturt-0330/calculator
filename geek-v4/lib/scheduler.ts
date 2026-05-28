// ============================================================
// lib/scheduler.ts — Heavy compute deferral primitives
// ============================================================
// Web: requestIdleCallback で main thread の空き時間に実行
// RN native: InteractionManager.runAfterInteractions(jsTimeout fallback)
//
// 用途: For-You ランキング / suggestClusters / search BM25 scoring など、
// "即座でなくて良いが UI に値を返す必要がある" 重い計算を 1tick 後ろに倒す。
// useDeferredValue が使えない箇所 (= useMemo の中で完結させたいが、計算が重い)
// で useEffect + setState で受ける時に使う。
//
// 注意:
//   - 同期的に値が必要な path (cache-dependent / critical first paint) では使わない
//   - timeout で 1s 以内に強制実行されるので I/O 待ちの放置にはならない
// ============================================================

type IdleCallback = (cb: () => void) => number | { cancel: () => void } | undefined;

const RIC: IdleCallback | undefined =
  typeof globalThis !== 'undefined'
    ? (globalThis as { requestIdleCallback?: IdleCallback }).requestIdleCallback
    : undefined;

const CIC: ((handle: number) => void) | undefined =
  typeof globalThis !== 'undefined'
    ? (globalThis as { cancelIdleCallback?: (handle: number) => void }).cancelIdleCallback
    : undefined;

/**
 * idle 時に fn を実行。Web は requestIdleCallback、無ければ setTimeout(0)。
 * timeout 内 (default 1s) に必ず実行される。
 * 返り値の cancel() で実行前なら中断できる。
 */
export function runWhenIdle(
  fn: () => void,
  opts?: { timeoutMs?: number },
): { cancel: () => void } {
  const timeoutMs = opts?.timeoutMs ?? 1000;
  if (typeof RIC === 'function') {
    // 標準仕様: requestIdleCallback(cb, { timeout })
    const handle = (RIC as unknown as (cb: () => void, opts?: { timeout: number }) => number)(
      fn,
      { timeout: timeoutMs },
    );
    return {
      cancel: () => {
        if (typeof CIC === 'function' && typeof handle === 'number') CIC(handle);
      },
    };
  }
  const tid = setTimeout(fn, 0);
  return {
    cancel: () => clearTimeout(tid),
  };
}
