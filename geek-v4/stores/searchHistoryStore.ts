import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'geek:search_history';
const KEY_V2 = 'geek:search_history_v2';  // タイムスタンプ付き
const MAX_HISTORY = 12;
const MAX_HISTORY_V2 = 50;

export type HistoryEntry = { q: string; ts: number };

type SearchHistoryState = {
  history: string[];
  entries: HistoryEntry[];  // ts 付き
  hydrated: boolean;
  hydrate: () => Promise<void>;
  add: (query: string) => void;
  remove: (query: string) => void;
  clear: () => void;
  recentInLastHour: () => string[];
};

export const useSearchHistoryStore = create<SearchHistoryState>((set, get) => ({
  history: [],
  entries: [],
  hydrated: false,
  hydrate: async () => {
    try {
      const [raw, rawV2] = await Promise.all([
        AsyncStorage.getItem(KEY),
        AsyncStorage.getItem(KEY_V2),
      ]);
      const history = raw ? (JSON.parse(raw) as string[]) : [];
      let entries: HistoryEntry[] = [];
      if (rawV2) {
        try { entries = JSON.parse(rawV2) as HistoryEntry[]; } catch {}
      }
      // 古い history からエントリを補完 (タイムスタンプは "今" で初期化)
      if (entries.length === 0 && history.length > 0) {
        entries = history.map((q) => ({ q, ts: Date.now() - 60_000 }));
      }
      set({ history, entries, hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },
  add: (query) => {
    const q = query.trim();
    if (!q) return;
    const cur = get().history.filter((h) => h !== q);
    const next = [q, ...cur].slice(0, MAX_HISTORY);
    const curE = get().entries.filter((e) => e.q !== q);
    const nextE = [{ q, ts: Date.now() }, ...curE].slice(0, MAX_HISTORY_V2);
    set({ history: next, entries: nextE });
    AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
    AsyncStorage.setItem(KEY_V2, JSON.stringify(nextE)).catch(() => {});
  },
  remove: (query) => {
    const next = get().history.filter((h) => h !== query);
    const nextE = get().entries.filter((e) => e.q !== query);
    set({ history: next, entries: nextE });
    AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
    AsyncStorage.setItem(KEY_V2, JSON.stringify(nextE)).catch(() => {});
  },
  clear: () => {
    set({ history: [], entries: [] });
    AsyncStorage.setItem(KEY, '[]').catch(() => {});
    AsyncStorage.setItem(KEY_V2, '[]').catch(() => {});
  },
  recentInLastHour: () => {
    const cutoff = Date.now() - 60 * 60 * 1000;
    return get().entries.filter((e) => e.ts >= cutoff).map((e) => e.q);
  },
}));
