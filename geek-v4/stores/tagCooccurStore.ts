import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

// タグの共起マトリクス: tag → { otherTag → 共出現回数 }
// 一定数の最近の投稿から計算してキャッシュする (1時間有効)
const KEY = 'geek:tag_cooccur_v1';
const TTL_MS = 60 * 60 * 1000;
const FETCH_LIMIT = 500;

export type CooccurMap = Record<string, Record<string, number>>;

type TagCooccurState = {
  cooccur: CooccurMap;
  tagPopularity: Record<string, number>; // 出現頻度
  fetchedAt: number | null;
  loading: boolean;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  refresh: () => Promise<void>;
  ensureFresh: () => Promise<void>;
};

async function persist(snapshot: { cooccur: CooccurMap; tagPopularity: Record<string, number>; fetchedAt: number }) {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {}
}

async function fetchAndCompute(): Promise<{ cooccur: CooccurMap; tagPopularity: Record<string, number> }> {
  // 最近の投稿の tag_names を取得して共起をカウント
  const { data } = await supabase
    .from('posts')
    .select('tag_names')
    .eq('is_anonymous', true)
    .eq('is_public', true)
    .order('created_at', { ascending: false })
    .limit(FETCH_LIMIT);

  const cooccur: CooccurMap = {};
  const tagPopularity: Record<string, number> = {};
  for (const post of (data ?? []) as { tag_names: string[] }[]) {
    const tags = post.tag_names ?? [];
    if (tags.length === 0) continue;
    for (const t of tags) {
      tagPopularity[t] = (tagPopularity[t] ?? 0) + 1;
    }
    if (tags.length < 2) continue;
    for (let i = 0; i < tags.length; i++) {
      for (let j = 0; j < tags.length; j++) {
        if (i === j) continue;
        const a = tags[i]!;
        const b = tags[j]!;
        if (!cooccur[a]) cooccur[a] = {};
        cooccur[a]![b] = (cooccur[a]![b] ?? 0) + 1;
      }
    }
  }
  return { cooccur, tagPopularity };
}

export const useTagCooccurStore = create<TagCooccurState>((set, get) => ({
  cooccur: {},
  tagPopularity: {},
  fetchedAt: null,
  loading: false,
  hydrated: false,
  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        set({
          cooccur: d.cooccur ?? {},
          tagPopularity: d.tagPopularity ?? {},
          fetchedAt: d.fetchedAt ?? null,
          hydrated: true,
        });
        return;
      }
    } catch {}
    set({ hydrated: true });
  },
  refresh: async () => {
    set({ loading: true });
    try {
      const { cooccur, tagPopularity } = await fetchAndCompute();
      const fetchedAt = Date.now();
      set({ cooccur, tagPopularity, fetchedAt, loading: false });
      void persist({ cooccur, tagPopularity, fetchedAt });
    } catch {
      set({ loading: false });
    }
  },
  ensureFresh: async () => {
    const { fetchedAt, loading, refresh } = get();
    if (loading) return;
    if (!fetchedAt || Date.now() - fetchedAt > TTL_MS) await refresh();
  },
}));
