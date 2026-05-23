import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { swallow } from '../lib/swallow';

// ============================================================
// Click-Through Learning
// ============================================================
// ユーザーがクエリ Q を入力 → サジェスト T を選んだ場合、
// (Q, T) のペアをローカルに記録し、次回 Q (またはその prefix) を
// 入力したときに T を強くブースト。
//
// Google の "Learning to Rank" の超簡易版。
// ローカル のみで動くので Privacy-friendly + 即座に反映。
//
// 構造:
//   queryToTagCount: Map<normalizedQuery, Map<tag, count>>
//   recentClicks: { query, tag, ts }[] (最大 100 件)
// ============================================================

const KEY = 'geek:search_clicks_v1';
const MAX_RECENT = 100;

export type ClickStats = {
  queryToTagCount: Record<string, Record<string, number>>;
  recentClicks: { q: string; t: string; ts: number }[];
};

type State = ClickStats & {
  hydrated: boolean;
  hydrate: () => Promise<void>;
  record: (query: string, tag: string) => void;
  // 引数 query に対して、過去にクリックされた tag → カウント を返す
  getBoosts: (query: string) => Record<string, number>;
  clear: () => void;
};

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase();
}

function save(s: ClickStats) {
  try {
    AsyncStorage.setItem(KEY, JSON.stringify(s)).catch((e) => swallow('store.searchClick.save', e));
  } catch (e) { swallow('store.searchClick.save.sync', e); }
}

export const useSearchClickStore = create<State>((set, get) => ({
  queryToTagCount: {},
  recentClicks: [],
  hydrated: false,

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw) as ClickStats;
        set({
          queryToTagCount: d.queryToTagCount ?? {},
          recentClicks: d.recentClicks ?? [],
          hydrated: true,
        });
        return;
      }
    } catch (e) { swallow('store.searchClick.hydrate', e); }
    set({ hydrated: true });
  },

  record: (query, tag) => {
    const nq = normalizeQuery(query);
    if (!nq || !tag) return;
    const { queryToTagCount, recentClicks } = get();
    const tagCounts = { ...(queryToTagCount[nq] ?? {}) };
    tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
    const nextMap = { ...queryToTagCount, [nq]: tagCounts };
    const nextRecent = [
      { q: nq, t: tag, ts: Date.now() },
      ...recentClicks.filter((r) => !(r.q === nq && r.t === tag)),
    ].slice(0, MAX_RECENT);
    set({ queryToTagCount: nextMap, recentClicks: nextRecent });
    save({ queryToTagCount: nextMap, recentClicks: nextRecent });
  },

  getBoosts: (query) => {
    const nq = normalizeQuery(query);
    if (!nq) return {};
    const { queryToTagCount } = get();
    // 完全一致クエリ + クエリの prefix を含むキーをマージ (短いクエリで部分一致も拾う)
    const result: Record<string, number> = {};
    for (const [k, v] of Object.entries(queryToTagCount)) {
      const w = k === nq ? 1.0 : k.startsWith(nq) || nq.startsWith(k) ? 0.5 : 0;
      if (w === 0) continue;
      for (const [tag, count] of Object.entries(v)) {
        result[tag] = (result[tag] ?? 0) + count * w;
      }
    }
    return result;
  },

  clear: () => {
    set({ queryToTagCount: {}, recentClicks: [] });
    save({ queryToTagCount: {}, recentClicks: [] });
  },
}));
