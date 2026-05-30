// =============================================================================
// profileVisibilityStore — マイページの「共有」「投稿」タブを公開/非公開で切替
// -----------------------------------------------------------------------------
// 本人がマイページタブのタブヘッダから「表示/非表示」をトグルする。非表示時:
//   - 自分視点では タブ自体は見えるが「非公開」バッジ + 中身は薄く伏せる
//   - 将来の他人視点 (app/profile/[id]) では、サーバー側のミラーフラグと合わせて
//     タブを丸ごと出さない設計に拡張可能
//
// 永続化は lib/storage の getJson/setJson (MMKV native / localStorage web)。
// 起動時に hydrate を 1 回呼ぶ (mypage.tsx 側で実行)。多重 hydrate は no-op。
// =============================================================================

import { create } from 'zustand';
import { getJson, setJson } from '../lib/storage';

const STORAGE_KEY = 'geekv4_profile_visibility_v1';

export interface ProfileVisibilityState {
  showShared: boolean;
  showPosts: boolean;
  hydrated: boolean;
  hydrate: () => void;
  setShowShared: (v: boolean) => void;
  setShowPosts: (v: boolean) => void;
}

type PersistShape = { showShared: boolean; showPosts: boolean };

export const useProfileVisibilityStore = create<ProfileVisibilityState>((set, get) => ({
  showShared: true,
  showPosts: true,
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    const saved = getJson<PersistShape>(STORAGE_KEY);
    if (saved && typeof saved === 'object') {
      set({
        showShared: saved.showShared !== false, // default true
        showPosts: saved.showPosts !== false,
        hydrated: true,
      });
    } else {
      set({ hydrated: true });
    }
  },

  setShowShared: (v) => {
    set({ showShared: v });
    const cur = get();
    setJson<PersistShape>(STORAGE_KEY, { showShared: v, showPosts: cur.showPosts });
  },
  setShowPosts: (v) => {
    set({ showPosts: v });
    const cur = get();
    setJson<PersistShape>(STORAGE_KEY, { showShared: cur.showShared, showPosts: v });
  },
}));
