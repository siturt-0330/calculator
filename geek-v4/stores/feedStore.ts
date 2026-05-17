import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SortMode } from '@/lib/api/posts';

export type FeedScope = 'open' | 'closed'; // open=全部+ブロックで除外, closed=好きタグのみ

type FeedState = {
  sort: SortMode;
  scope: FeedScope;
  setSort: (sort: SortMode) => void;
  setScope: (scope: FeedScope) => void;
  hydrate: () => Promise<void>;
};

const KEY = 'geek:feed';

export const useFeedStore = create<FeedState>((set, get) => ({
  sort: 'hot',
  scope: 'open',
  setSort: (sort) => {
    set({ sort });
    AsyncStorage.setItem(KEY, JSON.stringify({ sort, scope: get().scope })).catch(() => {});
  },
  setScope: (scope) => {
    set({ scope });
    AsyncStorage.setItem(KEY, JSON.stringify({ sort: get().sort, scope })).catch(() => {});
  },
  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { sort?: SortMode; scope?: FeedScope };
        set({ sort: parsed.sort ?? 'hot', scope: parsed.scope ?? 'open' });
      }
    } catch {}
  },
}));
