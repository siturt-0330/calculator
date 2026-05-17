import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Lang = 'ja' | 'en' | 'zh' | 'ko' | 'es' | 'fr';

export const LANG_OPTIONS: { code: Lang; name: string; native: string; flag: string }[] = [
  { code: 'ja', name: 'Japanese',  native: '日本語',     flag: '🇯🇵' },
  { code: 'en', name: 'English',   native: 'English',   flag: '🇺🇸' },
  { code: 'zh', name: 'Chinese',   native: '中文',       flag: '🇨🇳' },
  { code: 'ko', name: 'Korean',    native: '한국어',     flag: '🇰🇷' },
  { code: 'es', name: 'Spanish',   native: 'Español',   flag: '🇪🇸' },
  { code: 'fr', name: 'French',    native: 'Français',  flag: '🇫🇷' },
];

const KEY = 'geek:lang';

type LangState = {
  lang: Lang;
  autoTranslate: boolean;  // 投稿/コメントを自動翻訳
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setLang: (l: Lang) => void;
  setAutoTranslate: (v: boolean) => void;
};

async function save(snapshot: { lang: Lang; autoTranslate: boolean }) {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {}
}

export const useLanguageStore = create<LangState>((set, get) => ({
  lang: 'ja',
  autoTranslate: false,
  hydrated: false,

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        set({ lang: d.lang ?? 'ja', autoTranslate: d.autoTranslate ?? false, hydrated: true });
        return;
      }
    } catch {}
    set({ hydrated: true });
  },
  setLang: (lang) => {
    set({ lang });
    const auto = lang !== 'ja';
    set({ autoTranslate: auto });
    void save({ lang, autoTranslate: auto });
  },
  setAutoTranslate: (autoTranslate) => {
    set({ autoTranslate });
    void save({ lang: get().lang, autoTranslate });
  },
}));
