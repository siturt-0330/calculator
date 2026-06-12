// ============================================================
// design/haptics — lib/haptics.ts への re-export (互換レイヤー)
// ============================================================
//
// haptic API の実体は lib/haptics.ts に統一済み (2026-06 監査)。
// 既存の `import { hap } from '../design/haptics'` を壊さないために
// re-export だけ残す。強度マッピングの変更は lib/haptics.ts で行う。
// (旧実装の pop=Heavy は lib 側に統一済み — DoubleTapHeart の IG 風体験を維持)
//
export { hap } from '../lib/haptics';
export type { HapticKind } from '../lib/haptics';
