import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SortMode } from '../lib/api/posts';
import { swallow } from '../lib/swallow';
import { shouldLandInInterestScope } from '../lib/feed/coldStart';

export type FeedScope = 'open' | 'closed'; // open=全部+ブロックで除外, closed=好きタグのみ

type FeedState = {
  sort: SortMode;
  scope: FeedScope;
  // cold-start 着地を「一生に一度だけ」適用したかの sentinel。永続化される。
  coldStartApplied: boolean;
  setSort: (sort: SortMode) => void;
  setScope: (scope: FeedScope) => void;
  // onboarding 完了時に呼ぶ: 初回だけ興味タグ持ちユーザーを closed scope に着地させる。
  applyColdStartScopeIfFirstRun: (likedCount: number) => void;
  hydrate: () => Promise<void>;
};

const KEY = 'geek:feed';

// 永続化は既存どおり AsyncStorage の単一 JSON blob (`geek:feed`)。
// sort / scope に加えて coldStartApplied も同じ blob に含めて 1 回で書く。
function persist(state: { sort: SortMode; scope: FeedScope; coldStartApplied: boolean }): void {
  AsyncStorage.setItem(KEY, JSON.stringify(state)).catch(() => {});
}

export const useFeedStore = create<FeedState>((set, get) => ({
  sort: 'for-you',
  scope: 'open',
  coldStartApplied: false,
  setSort: (sort) => {
    set({ sort });
    const { scope, coldStartApplied } = get();
    persist({ sort, scope, coldStartApplied });
  },
  setScope: (scope) => {
    set({ scope });
    const { sort, coldStartApplied } = get();
    persist({ sort, scope, coldStartApplied });
  },
  applyColdStartScopeIfFirstRun: (likedCount) => {
    // 一度でも適用済みなら二度と触らない (後日タグを追加しても再発火しない one-shot)。
    if (get().coldStartApplied) return;
    // flag ON かつ興味タグが閾値以上のときだけ closed (興味スコープ) へ着地。
    // flag OFF / 興味 0 件のときは scope を変えない → feed.tsx の
    // 「好きタグ無しなら open へ強制」safety net がそのまま open を維持する。
    if (shouldLandInInterestScope(likedCount)) {
      set({ scope: 'closed' });
    }
    // 着地させなかった場合も含め、必ず sentinel を立てて永続化する (one-shot 保証)。
    set({ coldStartApplied: true });
    const { sort, scope } = get();
    persist({ sort, scope, coldStartApplied: true });
  },
  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          sort?: SortMode;
          scope?: FeedScope;
          coldStartApplied?: boolean;
        };
        set({
          sort: parsed.sort ?? 'for-you',
          scope: parsed.scope ?? 'open',
          coldStartApplied: parsed.coldStartApplied ?? false,
        });
      }
    } catch (e) { swallow('store.feed.hydrate', e); }
  },
}));
