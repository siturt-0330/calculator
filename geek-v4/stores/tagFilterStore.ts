import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_LIKED = 'geek:liked_tags';
const KEY_BLOCKED = 'geek:blocked_tags';

type TagFilterState = {
  likedTags: string[];
  blockedTags: string[];
  hydrated: boolean;
  addLiked: (tag: string) => void;
  removeLiked: (tag: string) => void;
  addBlocked: (tag: string) => void;
  removeBlocked: (tag: string) => void;
  hydrate: () => Promise<void>;
};

export const useTagFilterStore = create<TagFilterState>((set, get) => ({
  likedTags: [],
  blockedTags: [],
  hydrated: false,
  hydrate: async () => {
    try {
      const [liked, blocked] = await Promise.all([
        AsyncStorage.getItem(KEY_LIKED),
        AsyncStorage.getItem(KEY_BLOCKED),
      ]);
      set({
        likedTags: liked ? (JSON.parse(liked) as string[]) : [],
        blockedTags: blocked ? (JSON.parse(blocked) as string[]) : [],
        hydrated: true,
      });
    } catch {
      set({ hydrated: true });
    }
  },
  addLiked: (tag) => {
    const liked = [...new Set([...get().likedTags, tag])];
    set({ likedTags: liked });
    AsyncStorage.setItem(KEY_LIKED, JSON.stringify(liked)).catch(() => {});
  },
  removeLiked: (tag) => {
    const liked = get().likedTags.filter((t) => t !== tag);
    set({ likedTags: liked });
    AsyncStorage.setItem(KEY_LIKED, JSON.stringify(liked)).catch(() => {});
  },
  addBlocked: (tag) => {
    const blocked = [...new Set([...get().blockedTags, tag])];
    set({ blockedTags: blocked });
    AsyncStorage.setItem(KEY_BLOCKED, JSON.stringify(blocked)).catch(() => {});
  },
  removeBlocked: (tag) => {
    const blocked = get().blockedTags.filter((t) => t !== tag);
    set({ blockedTags: blocked });
    AsyncStorage.setItem(KEY_BLOCKED, JSON.stringify(blocked)).catch(() => {});
  },
}));
