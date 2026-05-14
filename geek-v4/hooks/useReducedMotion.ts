import { useSettingsStore } from '@/stores/settingsStore';

export function useReducedMotion(): boolean {
  return useSettingsStore((s) => s.reduceMotion);
}
