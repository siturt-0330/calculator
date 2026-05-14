import { create } from 'zustand';
import { MMKV } from 'react-native-mmkv';

const storage = new MMKV({ id: 'settings' });

type Settings = {
  language: 'ja' | 'en';
  notifyLike: boolean;
  notifyComment: boolean;
  notifyFollow: boolean;
  notifyEvent: boolean;
  reduceMotion: boolean;
};

const DEFAULTS: Settings = {
  language: 'ja',
  notifyLike: true,
  notifyComment: true,
  notifyFollow: true,
  notifyEvent: true,
  reduceMotion: false,
};

type SettingsState = Settings & {
  hydrated: boolean;
  hydrate: () => void;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
};

export const useSettingsStore = create<SettingsState>((set) => ({
  ...DEFAULTS,
  hydrated: false,
  hydrate: () => {
    const saved = storage.getString('settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Partial<Settings>;
        set({ ...DEFAULTS, ...parsed, hydrated: true });
        return;
      } catch { /* use defaults */ }
    }
    set({ hydrated: true });
  },
  update: (key, value) => {
    set((state) => {
      const next = { ...state, [key]: value };
      storage.set('settings', JSON.stringify(next));
      return { [key]: value };
    });
  },
}));
