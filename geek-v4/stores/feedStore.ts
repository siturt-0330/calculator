import { create } from 'zustand';

type FeedMode = 'latest' | 'trend';

type FeedState = {
  mode: FeedMode;
  setMode: (mode: FeedMode) => void;
};

export const useFeedStore = create<FeedState>((set) => ({
  mode: 'latest',
  setMode: (mode) => set({ mode }),
}));
