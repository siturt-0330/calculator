import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_LIKED = 'geek:liked_tags';
const KEY_BLOCKED = 'geek:blocked_tags';
// v4: ゴシップ/スキャンダル/事件報道など、人が不幸になる関連のタグを追加
const KEY_BLOCKED_INIT = 'geek:blocked_tags_init_v4';
const KEY_BLOCKED_INIT_V1 = 'geek:blocked_tags_init_v1';
const KEY_BLOCKED_INIT_V2 = 'geek:blocked_tags_init_v2';
const KEY_BLOCKED_INIT_V3 = 'geek:blocked_tags_init_v3';

// 「人が不幸になる」「トラブル」「スキャンダル」系のタグ — トレンド/フィードから
// 強制除外する用途で使う。DEFAULT_BLOCKED_TAGS とマージしてユーザーの初回 hydrate
// 時にもブロックリストへ入る。
// このカテゴリは trending では**ユーザー設定に関わらず**絶対に出さない (= 検閲ではなく
// 「健全な趣味 SNS」というプロダクト価値の表明)。
export const GOSSIP_TRENDING_BLOCKLIST = [
  // 不倫・スキャンダル系
  '浮気', '不倫', '熱愛', '熱愛報道', 'スクープ', '報道', 'ゴシップ', 'ゴシップ記事',
  '暴露', '暴露話', '流出', 'リーク', 'リーク情報', '文春', '文春砲', '週刊文春',
  '週刊誌', 'フライデー', '新潮', '芸能ニュース', 'スキャンダル',
  '略奪愛', '二股', '三股', '不貞', '離婚', '別居', '修羅場', '不仲', '破局',
  // 事件・事故・犯罪報道
  '事件', '事故', '訴訟', '裁判', '逮捕', '書類送検', '容疑', '容疑者',
  '殺人', '殺害', '殺人事件', '強盗事件', '暴行', '暴行事件', '誘拐',
  '不祥事', '謝罪会見', '辞任', '解雇', '解任', '降格',
  // 死亡・訃報
  '死亡', '訃報', '死去', '急逝', '逝去', '自殺報道', '事故死', '突然死',
  // 炎上・批判
  '炎上', '炎上中', '大炎上', '叩き', '炎上商法', '物議', '批判殺到',
];

// 初回のみ自動で適用されるデフォルトのブロックタグ
// 削除可能 (ユーザーは自由に解除できる)
export const DEFAULT_BLOCKED_TAGS = [
  // 詐欺・悪徳ビジネス
  '詐欺', '詐欺かも', '情報商材', 'マルチ', 'マルチ商法', 'ネットワークビジネス',
  '悪徳業者', '悪徳商法', 'ねずみ講', '副業詐欺', '投資詐欺',
  'フィッシング', 'ロマンス詐欺', 'オレオレ詐欺', '特殊詐欺', 'なりすまし',
  // 闇バイト・犯罪関与
  '闇バイト', '強盗', '窃盗', '違法行為',
  // 暴力・反社
  '暴力', '性暴力', '反社', '反社会的勢力', '脅迫', 'テロ', 'テロリズム', '過激思想',
  // 虐待・DV
  '虐待', '児童虐待', '動物虐待', 'DV', '家庭内暴力', 'ネグレクト',
  // 自殺・自傷
  '自殺', '自傷', 'リストカット', '希死念慮', '自殺勧誘',
  // わいせつ・性的搾取
  'わいせつ', 'アダルト', '性的搾取', 'リベンジポルノ', '盗撮', '盗聴',
  '援助交際', '援交', '出会い系', '出会い厨',
  // 夜職・風俗
  'キャバクラ', 'キャバ嬢', 'ホスト', '風俗', 'クラブ', '夜職',
  'パパ活', 'ママ活', 'ギャラ飲み',
  // ハラスメント・差別
  'いじめ', 'パワハラ', 'セクハラ', 'モラハラ', '差別', 'ヘイト',
  'ストーカー', 'ストーキング', '誹謗中傷', '中傷', 'アンチ', '晒し', '住所特定',
  '個人情報',
  // フェイク・誤情報
  '嘘', 'デマ', 'フェイクニュース', '陰謀論', '反ワクチン', '医療デマ', 'トンデモ医療',
  // 薬物・違法物
  'ギャンブル', '違法薬物', '大麻', '覚醒剤', '麻薬', '危険ドラッグ',
  // カルト・勧誘
  'カルト', '宗教勧誘', '勧誘',
  // 過激コンテンツ
  'グロ', '流血', '死体', '猟奇',
  // ゴシップ・スキャンダル・事件報道 (v4 で追加)
  ...GOSSIP_TRENDING_BLOCKLIST,
];

// Set 化したもの — fetchTrending 等でホットパスで毎回構築しなくて済むようエクスポート
export const GOSSIP_TRENDING_BLOCKLIST_SET = new Set(GOSSIP_TRENDING_BLOCKLIST);

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
      const [liked, blocked, initCurrent, initV1, initV2, initV3] = await Promise.all([
        AsyncStorage.getItem(KEY_LIKED),
        AsyncStorage.getItem(KEY_BLOCKED),
        AsyncStorage.getItem(KEY_BLOCKED_INIT),    // = v4 現行
        AsyncStorage.getItem(KEY_BLOCKED_INIT_V1),
        AsyncStorage.getItem(KEY_BLOCKED_INIT_V2),
        AsyncStorage.getItem(KEY_BLOCKED_INIT_V3),
      ]);
      const likedArr = liked ? (JSON.parse(liked) as string[]) : [];
      let blockedArr = blocked ? (JSON.parse(blocked) as string[]) : [];

      // 現行 init キー未適用 → デフォルトの安全タグを追加
      // 既に解除済みのタグも再ブロックされるが、それが社会的に推奨される運用
      if (!initCurrent) {
        const merged = new Set(blockedArr);
        for (const t of DEFAULT_BLOCKED_TAGS) merged.add(t);
        blockedArr = [...merged];
        await AsyncStorage.setItem(KEY_BLOCKED, JSON.stringify(blockedArr)).catch((e) => console.warn('[tagFilterStore] AsyncStorage write failed:', e));
        await AsyncStorage.setItem(KEY_BLOCKED_INIT, '1').catch((e) => console.warn('[tagFilterStore] AsyncStorage write failed:', e));
        // 旧キーは消しておく (二度と評価しない)
        if (initV1) await AsyncStorage.removeItem(KEY_BLOCKED_INIT_V1).catch((e) => console.warn('[tagFilterStore] AsyncStorage write failed:', e));
        if (initV2) await AsyncStorage.removeItem(KEY_BLOCKED_INIT_V2).catch((e) => console.warn('[tagFilterStore] AsyncStorage write failed:', e));
        if (initV3) await AsyncStorage.removeItem(KEY_BLOCKED_INIT_V3).catch((e) => console.warn('[tagFilterStore] AsyncStorage write failed:', e));
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
    AsyncStorage.setItem(KEY_LIKED, JSON.stringify(liked)).catch((e) => console.warn('[tagFilterStore] AsyncStorage write failed:', e));
    AsyncStorage.setItem(KEY_BLOCKED, JSON.stringify(blocked)).catch((e) => console.warn('[tagFilterStore] AsyncStorage write failed:', e));
  },
  removeLiked: (tag) => {
    const liked = get().likedTags.filter((t) => t !== tag);
    set({ likedTags: liked });
    AsyncStorage.setItem(KEY_LIKED, JSON.stringify(liked)).catch((e) => console.warn('[tagFilterStore] AsyncStorage write failed:', e));
  },
  addBlocked: (tag) => {
    const { likedTags, blockedTags } = get();
    // 好きリストに同じタグがあれば外す（重複禁止）
    const liked = likedTags.filter((t) => t !== tag);
    const blocked = [...new Set([...blockedTags, tag])];
    set({ likedTags: liked, blockedTags: blocked });
    AsyncStorage.setItem(KEY_LIKED, JSON.stringify(liked)).catch((e) => console.warn('[tagFilterStore] AsyncStorage write failed:', e));
    AsyncStorage.setItem(KEY_BLOCKED, JSON.stringify(blocked)).catch((e) => console.warn('[tagFilterStore] AsyncStorage write failed:', e));
  },
  removeBlocked: (tag) => {
    const blocked = get().blockedTags.filter((t) => t !== tag);
    set({ blockedTags: blocked });
    AsyncStorage.setItem(KEY_BLOCKED, JSON.stringify(blocked)).catch((e) => console.warn('[tagFilterStore] AsyncStorage write failed:', e));
  },
}));
