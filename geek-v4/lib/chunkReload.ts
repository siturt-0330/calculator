// ============================================================
// chunkReload.ts — コード分割 chunk の stale 404 自動復帰 (native no-op)
// ------------------------------------------------------------
// native (iOS/Android) は JS が単一バンドルで配信され route chunk 分割が
// 無いため、この guard は何もしない。web 実装は chunkReload.web.ts。
// (Metro の platform-extension 解決で web ビルドは .web.ts が優先される)
// ============================================================

/** web 専用の chunk 読込エラー自動リロード guard。native では no-op。 */
export function installChunkReloadGuard(): void {
  // no-op (native)
}
