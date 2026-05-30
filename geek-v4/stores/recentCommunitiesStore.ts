// ============================================================
// recentCommunitiesStore — 最近見たコミュニティ履歴 (HomeDrawer「履歴」)
// ------------------------------------------------------------
// コミュニティ詳細 (app/(tabs)/community/[id]/index.tsx) を開くたびに
// record() で先頭に積む。同一コミュは除去して繰り上げ (LRU)。最大 MAX_RECENT 件。
// lib/storage (MMKV native / localStorage web) に同期永続化するので cold start
// でも await 無しで即 hydrate できる。
//
// 設計 (CLAUDE.md 準拠):
//   - Zustand selector で購読する前提 (§5.4 destructure 禁止)。
//   - 永続化は lib/storage の getJson/setJson 経由 (window 直叩き禁止, §5.7)。
//   - 表示に必要な最小メタ (id/name/icon_*/member_count) だけ保持し、
//     drawer の CommunityRow / Avatar にそのまま渡せる shape にする。
//   - record() は hydrate 前に呼ばれても保存履歴を握り潰さないよう、
//     先に hydrate() を通してから前置 (clobber 防止)。
// ============================================================
import { create } from 'zustand';
import { getJson, setJson } from '../lib/storage';

/** drawer の CommunityRow にそのまま渡せる最小コミュニティメタ + 閲覧時刻 */
export interface RecentCommunity {
  id: string;
  name: string;
  icon_url: string | null;
  icon_emoji: string;
  icon_color: string;
  member_count: number;
  /** 最後に開いた時刻 (epoch ms) */
  viewedAt: number;
}

const STORAGE_KEY = 'geekv4_recent_communities_v1';
const MAX_RECENT = 12;

interface RecentCommunitiesState {
  items: RecentCommunity[];
  hydrated: boolean;
  /** storage から復元 (sync)。多重呼び出しは no-op。 */
  hydrate: () => void;
  /** 1 コミュニティを「最近見た」先頭に積む (重複は繰り上げ)。 */
  record: (c: Omit<RecentCommunity, 'viewedAt'>) => void;
  /** 履歴を全消去 (設定の「履歴を消す」等で利用想定)。 */
  clear: () => void;
}

export const useRecentCommunitiesStore = create<RecentCommunitiesState>((set, get) => ({
  items: [],
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    const saved = getJson<RecentCommunity[]>(STORAGE_KEY);
    set({ items: Array.isArray(saved) ? saved : [], hydrated: true });
  },

  record: (c) => {
    if (!c.id) return;
    // hydrate 前に record されると保存済み履歴を [新規 1 件] で上書きしてしまうので、
    // 先に storage から復元してから前置する。
    if (!get().hydrated) get().hydrate();
    const next: RecentCommunity[] = [
      { ...c, viewedAt: Date.now() },
      ...get().items.filter((x) => x.id !== c.id),
    ].slice(0, MAX_RECENT);
    set({ items: next });
    setJson(STORAGE_KEY, next);
  },

  clear: () => {
    set({ items: [] });
    setJson(STORAGE_KEY, []);
  },
}));
