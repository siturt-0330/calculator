import { create } from 'zustand';

type UIState = {
  isPostModalOpen: boolean;
  isFilterOpen: boolean;
  setPostModalOpen: (v: boolean) => void;
  setFilterOpen: (v: boolean) => void;
};

export const useUIStore = create<UIState>((set) => ({
  isPostModalOpen: false,
  isFilterOpen: false,
  setPostModalOpen: (v) => set({ isPostModalOpen: v }),
  setFilterOpen: (v) => set({ isFilterOpen: v }),
}));
