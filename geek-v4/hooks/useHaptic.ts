import { useCallback } from 'react';
// haptic API の実体は lib/haptics.ts に統一 (このフックは thin wrapper)
import { hap, type HapticKind } from '../lib/haptics';

export function useHaptic(kind: HapticKind = 'tap') {
  return useCallback(() => hap[kind](), [kind]);
}
