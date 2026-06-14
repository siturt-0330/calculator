import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SortMode } from '../lib/api/posts';
import { swallow } from '../lib/swallow';

export type FeedScope = 'open' | 'closed'; // open=全部+ブロックで除外, closed=好きタグのみ

type FeedState = {
  sort: SortMode;
  scope: FeedScope;
  setSort: (sort: SortMode) => void;
  setScope: (scope: FeedScope) => void;
  hydrate: () => Promise<void>;
};

const KEY = 'geek:feed';
// 2026-06-14: scope='closed' の意味が「未参加コミュの投稿(発見モード)」→「コンテスト」に
//   変わったため、旧バージョンで closed を永続化していたユーザーを一度だけ open にリセットする。
//   このフラグが立っていれば移行済み (= closed は本人が選んだコンテスト表示として尊重する)。
const SCOPE_V2_MIGRATED_KEY = 'geek:feed:scopeV2Migrated';

export const useFeedStore = create<FeedState>((set, get) => ({
  sort: 'for-you',
  scope: 'open',
  setSort: (sort) => {
    set({ sort });
    AsyncStorage.setItem(KEY, JSON.stringify({ sort, scope: get().scope })).catch(() => {});
  },
  setScope: (scope) => {
    set({ scope });
    AsyncStorage.setItem(KEY, JSON.stringify({ sort: get().sort, scope })).catch(() => {});
  },
  hydrate: async () => {
    try {
      const [raw, migrated] = await Promise.all([
        AsyncStorage.getItem(KEY),
        AsyncStorage.getItem(SCOPE_V2_MIGRATED_KEY),
      ]);
      if (raw) {
        const parsed = JSON.parse(raw) as { sort?: SortMode; scope?: FeedScope };
        const sort = parsed.sort ?? 'for-you';
        let scope = parsed.scope ?? 'open';
        // 旧 'closed'(発見モード) を初回起動時に一度だけ 'open' へ正規化。
        // 永続値も書き戻して、移行フラグ設定後に再び closed を読み戻さないようにする。
        if (!migrated && scope === 'closed') {
          scope = 'open';
          AsyncStorage.setItem(KEY, JSON.stringify({ sort, scope })).catch(() => {});
        }
        set({ sort, scope });
      }
      if (!migrated) {
        AsyncStorage.setItem(SCOPE_V2_MIGRATED_KEY, '1').catch(() => {});
      }
    } catch (e) { swallow('store.feed.hydrate', e); }
  },
}));
