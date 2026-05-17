import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'geek:search_history';
const MAX_HISTORY = 12;

type SearchHistoryState = {
  history: string[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  add: (query: string) => void;
  remove: (query: string) => void;
  clear: () => void;
};

export const useSearchHistoryStore = create<SearchHistoryState>((set, get) => ({
  history: [],
  hydrated: false,
  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw) {
        set({ history: JSON.parse(raw) as string[], hydrated: true });
        return;
      }
    } catch {}
    set({ hydrated: true });
  },
  add: (query) => {
    const q = query.trim();
    if (!q) return;
    const cur = get().history.filter((h) => h !== q);
    const next = [q, ...cur].slice(0, MAX_HISTORY);
    set({ history: next });
    AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
  },
  remove: (query) => {
    const next = get().history.filter((h) => h !== query);
    set({ history: next });
    AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
  },
  clear: () => {
    set({ history: [] });
    AsyncStorage.setItem(KEY, '[]').catch(() => {});
  },
}));
