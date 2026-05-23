// ============================================================
// swallow — try { ... } catch {} の代替ヘルパー
// ============================================================
// 旧コードは `try { something(); } catch {}` で error を完全に握りつぶしていた。
// 99% は意図的な defensive code (storage アクセス失敗、optional feature 等) だが、
// **本当に何かが壊れている** ケースも紛れ込む。
//
// swallow() を使うと:
//   1. error は本筋を止めない (= catch {} と同じ挙動)
//   2. Sentry breadcrumb として level=warning で残る (= "後で診断可能")
//   3. __DEV__ では console.warn にも出る
//
// 使い方:
//   try { localStorage.setItem(k, v); } catch (e) { swallow('storage.set', e); }
//
// scope は category 識別用 (Sentry breadcrumb の category として使う)。
// 短く、grep しやすい固定キーを推奨: 'storage.set', 'sentry.init', 'history.replace' 等
// ============================================================

type SentryLike = {
  addBreadcrumb?: (b: {
    category?: string;
    message?: string;
    level?: 'fatal' | 'error' | 'warning' | 'info' | 'debug';
    data?: Record<string, unknown>;
  }) => void;
};

function getSentry(): SentryLike | undefined {
  return (globalThis as { Sentry?: SentryLike }).Sentry;
}

/**
 * 例外を本筋に伝播させずに Sentry breadcrumb に記録する。
 * @param scope 短い識別子 (例: 'storage.set', 'sentry.init')
 * @param err   catch(e) で受け取った値
 */
export function swallow(scope: string, err: unknown): void {
  try {
    const msg = err instanceof Error ? err.message : String(err);
    const s = getSentry();
    s?.addBreadcrumb?.({
      category: `swallow.${scope}`,
      message: msg.slice(0, 200),
      level: 'warning',
    });
    // 開発中は気づけるように console にも出す (production では transform-remove-console で除去)
    // eslint-disable-next-line no-console
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn(`[swallow:${scope}]`, msg);
    }
  } catch {
    // breadcrumb 書き込み自体が失敗してもクラッシュさせない
  }
}
