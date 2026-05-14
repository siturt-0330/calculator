import { create } from 'zustand';
import { MMKV } from 'react-native-mmkv';

const storage = new MMKV({ id: 'tagFilter' });

type TagFilterState = {
  likedTags: string[];
  blockedTags: string[];
  addLiked: (tag: string) => void;
  removeLiked: (tag: string) => void;
  addBlocked: (tag: string) => void;
  removeBlocked: (tag: string) => void;
  hydrate: () => void;
};

function save(liked: string[], blocked: string[]) {
  storage.set('liked', JSON.stringify(liked));
  storage.set('blocked', JSON.stringify(blocked));
}

export const useTagFilterStore = create<TagFilterState>((set, get) => ({
  likedTags: [],
  blockedTags: [],
  hydrate: () => {
    const liked = JSON.parse(storage.getString('liked') ?? '[]') as string[];
    const blocked = JSON.parse(storage.getString('blocked') ?? '[]') as string[];
    set({ likedTags: liked, blockedTags: blocked });
  },
  addLiked: (tag) => {
    const liked = [...get().likedTags, tag].filter((v, i, a) => a.indexOf(v) === i);
    set({ likedTags: liked });
    save(liked, get().blockedTags);
  },
  removeLiked: (tag) => {
    const liked = get().likedTags.filter((t) => t !== tag);
    set({ likedTags: liked });
    save(liked, get().blockedTags);
  },
  addBlocked: (tag) => {
    const blocked = [...get().blockedTags, tag].filter((v, i, a) => a.indexOf(v) === i);
    set({ blockedTags: blocked });
    save(get().likedTags, blocked);
  },
  removeBlocked: (tag) => {
    const blocked = get().blockedTags.filter((t) => t !== tag);
    set({ blockedTags: blocked });
    save(get().likedTags, blocked);
  },
}));
