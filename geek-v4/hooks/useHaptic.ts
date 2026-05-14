import { useCallback } from 'react';
import { hap, type HapticKind } from '@/design/haptics';

export function useHaptic(kind: HapticKind = 'tap') {
  return useCallback(() => hap[kind](), [kind]);
}
