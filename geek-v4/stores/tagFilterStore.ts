import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_LIKED = 'geek:liked_tags';
const KEY_BLOCKED = 'geek:blocked_tags';
const KEY_BLOCKED_INIT = 'geek:blocked_tags_init_v1';

// 初回のみ自動で適用されるデフォルトのブロックタグ
// 削除可能 (ユーザーは自由に解除できる)
export const DEFAULT_BLOCKED_TAGS = [
  '詐欺', '詐欺かも', '情報商材',
  '暴力', '性暴力', '反社',
  'キャバクラ', 'キャバ嬢', 'ホスト', '風俗', 'クラブ', '夜職',
  'ニューハーフ',
  'いじめ', '嘘',
];

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
      const [liked, blocked, initApplied] = await Promise.all([
        AsyncStorage.getItem(KEY_LIKED),
        AsyncStorage.getItem(KEY_BLOCKED),
        AsyncStorage.getItem(KEY_BLOCKED_INIT),
      ]);
      const likedArr = liked ? (JSON.parse(liked) as string[]) : [];
      let blockedArr = blocked ? (JSON.parse(blocked) as string[]) : [];
      // 初回のみデフォルトのブロックタグを適用
      if (!initApplied) {
        const merged = new Set(blockedArr);
        for (const t of DEFAULT_BLOCKED_TAGS) merged.add(t);
        blockedArr = [...merged];
        await AsyncStorage.setItem(KEY_BLOCKED, JSON.stringify(blockedArr)).catch(() => {});
        await AsyncStorage.setItem(KEY_BLOCKED_INIT, '1').catch(() => {});
      }
      set({
        likedTags: likedArr,
        blockedTags: blockedArr,
        hydrated: true,
      });
    } catch {
      set({ hydrated: true });
    }
  },
  addLiked: (tag) => {
    const { likedTags, blockedTags } = get();
    // ブロックリストに同じタグがあれば外す（重複禁止）
    const blocked = blockedTags.filter((t) => t !== tag);
    const liked = [...new Set([...likedTags, tag])];
    set({ likedTags: liked, blockedTags: blocked });
    AsyncStorage.setItem(KEY_LIKED, JSON.stringify(liked)).catch(() => {});
    AsyncStorage.setItem(KEY_BLOCKED, JSON.stringify(blocked)).catch(() => {});
  },
  removeLiked: (tag) => {
    const liked = get().likedTags.filter((t) => t !== tag);
    set({ likedTags: liked });
    AsyncStorage.setItem(KEY_LIKED, JSON.stringify(liked)).catch(() => {});
  },
  addBlocked: (tag) => {
    const { likedTags, blockedTags } = get();
    // 好きリストに同じタグがあれば外す（重複禁止）
    const liked = likedTags.filter((t) => t !== tag);
    const blocked = [...new Set([...blockedTags, tag])];
    set({ likedTags: liked, blockedTags: blocked });
    AsyncStorage.setItem(KEY_LIKED, JSON.stringify(liked)).catch(() => {});
    AsyncStorage.setItem(KEY_BLOCKED, JSON.stringify(blocked)).catch(() => {});
  },
  removeBlocked: (tag) => {
    const blocked = get().blockedTags.filter((t) => t !== tag);
    set({ blockedTags: blocked });
    AsyncStorage.setItem(KEY_BLOCKED, JSON.stringify(blocked)).catch(() => {});
  },
}));
