import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { swallow } from '../lib/swallow';

export type Lang = 'ja' | 'en' | 'zh' | 'ko' | 'es' | 'fr' | 'th' | 'vi' | 'id';

export const LANG_OPTIONS: { code: Lang; name: string; native: string; flag: string }[] = [
  { code: 'ja', name: 'Japanese',  native: '日本語',     flag: '🇯🇵' },
  { code: 'en', name: 'English',   native: 'English',   flag: '🇺🇸' },
  { code: 'zh', name: 'Chinese',   native: '中文',       flag: '🇨🇳' },
  { code: 'ko', name: 'Korean',    native: '한국어',     flag: '🇰🇷' },
  { code: 'th', name: 'Thai',      native: 'ภาษาไทย',   flag: '🇹🇭' },
  { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt', flag: '🇻🇳' },
  { code: 'id', name: 'Indonesian', native: 'Bahasa Indonesia', flag: '🇮🇩' },
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
  } catch (e) { swallow('store.language.save', e); }
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
    } catch (e) { swallow('store.language.hydrate', e); }
    set({ hydrated: true });
  },
  // ★ 2026-05-25 改修: setLang から autoTranslate の自動連動を撤廃。
  //
  // 旧仕様: setLang('en') すると autoTranslate=true を自動セット → ユーザーが
  //         「言語を英語に変えたら勝手に日本語投稿が翻訳されて表示」される事故。
  //         オンボーディングで誤タップ + 設定変更画面の不在 + DICT 不足で UI が
  //         一見日本語のまま、という条件が重なって「気付かないまま英語化」現象が
  //         起きていた (production 報告)。
  //
  // 新仕様: lang のみを更新。autoTranslate はユーザーが明示的に setAutoTranslate
  //         で切替する。設定 → 言語画面に独立 toggle を配置。
  //
  // ※ 既存ユーザーで autoTranslate=true が保存されている人は引き続き翻訳が走るが、
  //   設定画面で off にできるようになるので破壊的変更ではない。
  setLang: (lang) => {
    set({ lang });
    void save({ lang, autoTranslate: get().autoTranslate });
  },
  setAutoTranslate: (autoTranslate) => {
    set({ autoTranslate });
    void save({ lang: get().lang, autoTranslate });
  },
}));
