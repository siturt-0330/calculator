// ============================================================
// Analytics — no-op implementation
// ============================================================
// PostHog (posthog-react-native) はバンドル肥大化のため完全除去。
// 互換性のため initAnalytics() / track() の API シグネチャは維持し、
// 内部実装は no-op に置き換え。既存呼び出し側 (lib/webVitals.ts 等) は
// そのまま動作する。将来別の analytics SDK を入れる場合はここを差し替え。
// ============================================================

export function initAnalytics(): void {
  // no-op
}

export function track(_event: string, _props?: Record<string, unknown>): void {
  // no-op
}
