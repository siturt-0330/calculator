import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ============================================================
// 広告関連のユーザー設定 — プライバシー観点での opt-out 用
// ============================================================
// `personalizedAds` が false の時、フィードへの広告挿入は完全にスキップする。
// 個人 id ベースのトラッキングは一切していないので、これは「タグマッチング
// すらしない」というユーザーの意思表示。
// ============================================================

const KEY = 'geek:ad_preferences';

type AdPreferencesState = {
  personalizedAds: boolean;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setPersonalizedAds: (v: boolean) => void;
};

export const useAdPreferencesStore = create<AdPreferencesState>((set) => ({
  personalizedAds: true,
  hydrated: false,
  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { personalizedAds?: unknown };
        const v = typeof parsed.personalizedAds === 'boolean' ? parsed.personalizedAds : true;
        set({ personalizedAds: v, hydrated: true });
        return;
      }
    } catch {}
    set({ hydrated: true });
  },
  setPersonalizedAds: (v) => {
    set({ personalizedAds: v });
    AsyncStorage.setItem(KEY, JSON.stringify({ personalizedAds: v })).catch(() => {});
  },
}));
