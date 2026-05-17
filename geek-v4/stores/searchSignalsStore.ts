import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

// 検索のクリック / 閲覧シグナルを記録してパーソナライズに使う
const KEY = 'geek:search_signals';
const MAX_SIGNALS = 200;

type Signal = {
  kind: 'post' | 'tag' | 'bbs';
  id: string;        // post id, tag name, thread id
  tags: string[];    // 関連タグ
  ts: number;        // unix ms
};

type Aggregated = {
  tagFreq: Record<string, number>;   // タグの閲覧頻度 (関心度)
  recentTags: string[];               // 直近のタグ
};

type SearchSignalsState = {
  signals: Signal[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  record: (s: Omit<Signal, 'ts'>) => void;
  aggregate: () => Aggregated;
};

export const useSearchSignalsStore = create<SearchSignalsState>((set, get) => ({
  signals: [],
  hydrated: false,
  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw) {
        set({ signals: JSON.parse(raw) as Signal[], hydrated: true });
        return;
      }
    } catch {}
    set({ hydrated: true });
  },
  record: (s) => {
    const cur = get().signals;
    const next: Signal[] = [{ ...s, ts: Date.now() }, ...cur].slice(0, MAX_SIGNALS);
    set({ signals: next });
    AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
  },
  aggregate: () => {
    const cur = get().signals;
    const now = Date.now();
    const tagFreq: Record<string, number> = {};
    const recentTagsSet = new Set<string>();
    // 直近 7日 を重視 (decay)
    for (const s of cur) {
      const ageH = (now - s.ts) / 3600000;
      const w = Math.exp(-ageH / 168); // 168h = 7日で 1/e
      for (const t of s.tags) {
        tagFreq[t] = (tagFreq[t] ?? 0) + w;
        if (ageH < 168) recentTagsSet.add(t);
      }
    }
    return { tagFreq, recentTags: [...recentTagsSet].slice(0, 20) };
  },
}));
