import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

type Settings = {
  language: 'ja' | 'en';
  notifyLike: boolean;
  notifyComment: boolean;
  notifyFollow: boolean;
  notifyEvent: boolean;
  reduceMotion: boolean;
  concernsPrivate: boolean;  // true: 気になるをこっそり付ける (投稿主に届かない)
};

const DEFAULTS: Settings = {
  language: 'ja',
  notifyLike: true,
  notifyComment: true,
  notifyFollow: true,
  notifyEvent: true,
  reduceMotion: false,
  concernsPrivate: true,
};

const KEY = 'geek:settings';

type SettingsState = Settings & {
  hydrated: boolean;
  hydrate: () => Promise<void>;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
};

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...DEFAULTS,
  hydrated: false,
  hydrate: async () => {
    try {
      const saved = await AsyncStorage.getItem(KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<Settings>;
        set({ ...DEFAULTS, ...parsed, hydrated: true });
        return;
      }
    } catch {}
    set({ hydrated: true });
  },
  update: (key, value) => {
    set({ [key]: value } as Pick<Settings, typeof key>);
    const state = get();
    const toSave: Settings = {
      language: state.language,
      notifyLike: state.notifyLike,
      notifyComment: state.notifyComment,
      notifyFollow: state.notifyFollow,
      notifyEvent: state.notifyEvent,
      reduceMotion: state.reduceMotion,
      concernsPrivate: state.concernsPrivate,
    };
    AsyncStorage.setItem(KEY, JSON.stringify(toSave)).catch(() => {});
  },
}));
