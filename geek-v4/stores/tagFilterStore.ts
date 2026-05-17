import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_LIKED = 'geek:liked_tags';
const KEY_BLOCKED = 'geek:blocked_tags';
// v2: より広い安全タグ群が追加されたので、init を打ち直して既存ユーザーにも反映
const KEY_BLOCKED_INIT = 'geek:blocked_tags_init_v2';
const KEY_BLOCKED_INIT_V1 = 'geek:blocked_tags_init_v1';

// 初回のみ自動で適用されるデフォルトのブロックタグ
// 削除可能 (ユーザーは自由に解除できる)
export const DEFAULT_BLOCKED_TAGS = [
  // 詐欺・悪徳ビジネス
  '詐欺', '詐欺かも', '情報商材', 'マルチ', 'マルチ商法', 'ネットワークビジネス',
  '悪徳業者', '悪徳商法', 'ねずみ講', '副業詐欺', '投資詐欺',
  // 暴力・反社
  '暴力', '性暴力', '反社', '反社会的勢力', '脅迫',
  // わいせつ・性的
  'わいせつ', 'アダルト', '性的搾取', 'リベンジポルノ',
  // 夜職・風俗
  'キャバクラ', 'キャバ嬢', 'ホスト', '風俗', 'クラブ', '夜職', 'パパ活', 'ギャラ飲み',
  // ハラスメント・差別
  'いじめ', 'パワハラ', 'セクハラ', '差別', 'ヘイト',
  // フェイク・誤情報
  '嘘', 'デマ', 'フェイクニュース',
  // その他リスク
  'ギャンブル', '違法薬物', 'カルト', '宗教勧誘',
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
      const [liked, blocked, initV2, initV1] = await Promise.all([
        AsyncStorage.getItem(KEY_LIKED),
        AsyncStorage.getItem(KEY_BLOCKED),
        AsyncStorage.getItem(KEY_BLOCKED_INIT),
        AsyncStorage.getItem(KEY_BLOCKED_INIT_V1),
      ]);
      const likedArr = liked ? (JSON.parse(liked) as string[]) : [];
      let blockedArr = blocked ? (JSON.parse(blocked) as string[]) : [];

      // v2 未適用 → デフォルトの安全タグを追加
      if (!initV2) {
        const merged = new Set(blockedArr);
        for (const t of DEFAULT_BLOCKED_TAGS) merged.add(t);
        blockedArr = [...merged];
        await AsyncStorage.setItem(KEY_BLOCKED, JSON.stringify(blockedArr)).catch(() => {});
        await AsyncStorage.setItem(KEY_BLOCKED_INIT, '1').catch(() => {});
        // v1 のキーは消しておく (二度と評価しない)
        if (initV1) await AsyncStorage.removeItem(KEY_BLOCKED_INIT_V1).catch(() => {});
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
