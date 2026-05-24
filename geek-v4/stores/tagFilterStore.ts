import { create } from 'zustand';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getJson,
  setJson,
  setBool,
  remove as storageRemove,
  contains as storageContains,
} from '../lib/storage';
// gossip blocklist は lib/gossipBlocklist.ts に切り出し済み (pure data, no deps)
// store 経由で参照しているコードのために re-export を維持
import {
  GOSSIP_TRENDING_BLOCKLIST as _GOSSIP_TRENDING_BLOCKLIST,
  GOSSIP_TRENDING_BLOCKLIST_SET as _GOSSIP_TRENDING_BLOCKLIST_SET,
} from '../lib/gossipBlocklist';

const KEY_LIKED = 'geek:liked_tags';
const KEY_BLOCKED = 'geek:blocked_tags';
// v4: ゴシップ/スキャンダル/事件報道など、人が不幸になる関連のタグを追加
const KEY_BLOCKED_INIT = 'geek:blocked_tags_init_v4';
const KEY_BLOCKED_INIT_V1 = 'geek:blocked_tags_init_v1';
const KEY_BLOCKED_INIT_V2 = 'geek:blocked_tags_init_v2';
const KEY_BLOCKED_INIT_V3 = 'geek:blocked_tags_init_v3';
// 旧 AsyncStorage キーから MMKV へ migrate 済みかの sentinel (native のみ)
const KEY_LEGACY_MIGRATED = 'geek:tag_filter:_migrated_v1';

// 後方互換のための re-export — 実体は lib/gossipBlocklist.ts
// (trending logic から RN 依存無しで参照できるよう、データは別 file に切り出し済み)
export const GOSSIP_TRENDING_BLOCKLIST = _GOSSIP_TRENDING_BLOCKLIST;

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
export const GOSSIP_TRENDING_BLOCKLIST_SET = _GOSSIP_TRENDING_BLOCKLIST_SET;

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

// ============================================================
// MMKV ベースの同期 hydrate
// ============================================================
// 旧 AsyncStorage の 6 並列 multiGet を捨て、MMKV の同期 1 回読みに置き換える。
// 旧データは native の場合のみ、最初の 1 回だけバックグラウンドで AsyncStorage
// から MMKV に転送する (Web は同じ localStorage 上に存在するので migrate 不要)。
// ============================================================

function loadStateSync(): { likedTags: string[]; blockedTags: string[] } {
  const liked = getJson<string[]>(KEY_LIKED);
  const blocked = getJson<string[]>(KEY_BLOCKED);
  const likedArr = Array.isArray(liked) ? liked.filter((s): s is string => typeof s === 'string') : [];
  let blockedArr = Array.isArray(blocked) ? blocked.filter((s): s is string => typeof s === 'string') : [];

  // 現行 init キー未適用 → デフォルトの安全タグを追加 (同期保存)
  if (!storageContains(KEY_BLOCKED_INIT)) {
    const merged = new Set(blockedArr);
    for (const t of DEFAULT_BLOCKED_TAGS) merged.add(t);
    blockedArr = [...merged];
    setJson(KEY_BLOCKED, blockedArr);
    setBool(KEY_BLOCKED_INIT, true);
    // 旧 init キー (v1-v3) は MMKV に転送されてれば即削除、無ければ無視
    if (storageContains(KEY_BLOCKED_INIT_V1)) storageRemove(KEY_BLOCKED_INIT_V1);
    if (storageContains(KEY_BLOCKED_INIT_V2)) storageRemove(KEY_BLOCKED_INIT_V2);
    if (storageContains(KEY_BLOCKED_INIT_V3)) storageRemove(KEY_BLOCKED_INIT_V3);
  }

  return { likedTags: likedArr, blockedTags: blockedArr };
}

// 旧 AsyncStorage から MMKV へ 1 度だけ migrate (native のみ)。
// 既に MMKV に値がある key は上書きしない (= 新規ユーザー / 既に使い始めてた
// ユーザーは MMKV 値を優先, 旧版から上げてきたユーザーのみ AsyncStorage 値を取り込む)。
async function migrateLegacyTagFilter(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  if (storageContains(KEY_LEGACY_MIGRATED)) return false;
  try {
    const pairs = await AsyncStorage.multiGet([
      KEY_LIKED,
      KEY_BLOCKED,
      KEY_BLOCKED_INIT,
      KEY_BLOCKED_INIT_V1,
      KEY_BLOCKED_INIT_V2,
      KEY_BLOCKED_INIT_V3,
    ]);
    let copiedSomething = false;
    for (const [k, v] of pairs) {
      if (v === null) continue;
      if (storageContains(k)) continue;
      // 元の AsyncStorage に入っていた raw string をそのまま MMKV に保存
      // (JSON or '1' フラグ — caller 側が読み出すときに parse)
      if (k === KEY_BLOCKED_INIT) {
        setBool(k, true);
      } else if (k.startsWith('geek:blocked_tags_init_')) {
        setBool(k, true);
      } else {
        try {
          // JSON array をそのまま再 stringify せず、 setJson で書き直す
          const parsed = JSON.parse(v);
          if (Array.isArray(parsed)) {
            setJson(k, parsed);
            copiedSomething = true;
          }
        } catch {
          /* skip 壊れたエントリ */
        }
      }
    }
    setBool(KEY_LEGACY_MIGRATED, true);
    return copiedSomething;
  } catch {
    // 失敗してもフラグは立てる
    setBool(KEY_LEGACY_MIGRATED, true);
    return false;
  }
}

export const useTagFilterStore = create<TagFilterState>((set, get) => ({
  likedTags: [],
  blockedTags: [],
  hydrated: false,
  hydrate: async () => {
    try {
      const sync = loadStateSync();
      set({ ...sync, hydrated: true });
    } catch {
      set({ hydrated: true });
    }
    // 旧 AsyncStorage 値があれば migrate → MMKV へ反映後、もう一度 sync load して
    // state を上書き。fire-and-forget なので hydrate 完了は遅延させない。
    void migrateLegacyTagFilter().then((migrated) => {
      if (!migrated) return;
      try {
        const sync = loadStateSync();
        // 現在の state が空 (= 初回 sync で MMKV にも何も無かった) のときだけ反映。
        // ユーザーが migrate 完了を待たずに操作開始してたら、その値を尊重する。
        const cur = get();
        if (cur.likedTags.length === 0 && cur.blockedTags.length === 0) {
          set(sync);
        }
      } catch {
        /* swallow */
      }
    });
  },
  addLiked: (tag) => {
    const { likedTags, blockedTags } = get();
    // ブロックリストに同じタグがあれば外す（重複禁止）
    const blocked = blockedTags.filter((t) => t !== tag);
    const liked = [...new Set([...likedTags, tag])];
    set({ likedTags: liked, blockedTags: blocked });
    setJson(KEY_LIKED, liked);
    setJson(KEY_BLOCKED, blocked);
  },
  removeLiked: (tag) => {
    const liked = get().likedTags.filter((t) => t !== tag);
    set({ likedTags: liked });
    setJson(KEY_LIKED, liked);
  },
  addBlocked: (tag) => {
    const { likedTags, blockedTags } = get();
    // 好きリストに同じタグがあれば外す（重複禁止）
    const liked = likedTags.filter((t) => t !== tag);
    const blocked = [...new Set([...blockedTags, tag])];
    set({ likedTags: liked, blockedTags: blocked });
    setJson(KEY_LIKED, liked);
    setJson(KEY_BLOCKED, blocked);
  },
  removeBlocked: (tag) => {
    const blocked = get().blockedTags.filter((t) => t !== tag);
    set({ blockedTags: blocked });
    setJson(KEY_BLOCKED, blocked);
  },
}));
