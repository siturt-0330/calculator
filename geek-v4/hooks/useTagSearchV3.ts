import { useCallback, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { NgramIndex } from '@/lib/search/ngramIndex';
import { buildEmbeddings } from '@/lib/search/embeddings';
import { Trie } from '@/lib/search/trie';
import { useTagGraphStore } from '@/stores/tagGraphStore';
import { useTagCooccurStore } from '@/stores/tagCooccurStore';
import { useTagFilterStore } from '@/stores/tagFilterStore';
import { useSearchSignalsStore } from '@/stores/searchSignalsStore';
import { useSearchClickStore } from '@/stores/searchClickStore';
import { searchTagsV3, type V3Result, type SearchV3Context } from '@/lib/search/tagSearchV3';

async function fetchAllTagNames(): Promise<string[]> {
  const { data } = await supabase
    .from('tags')
    .select('name')
    .order('member_count', { ascending: false })
    .limit(500);
  return (data ?? []).map((t: { name: string }) => t.name);
}

async function fetchTrendingTagNames(): Promise<string[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('posts')
    .select('tag_names')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(200);
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as Array<{ tag_names: string[] }>) {
    for (const t of row.tag_names ?? []) counts[t] = (counts[t] ?? 0) + 1;
  }
  return Object.entries(counts)
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([t]) => t);
}

export function useTagSearchV3() {
  const { nodes, hydrate: hydrateGraph } = useTagGraphStore();
  const { cooccur, tagPopularity, hydrate: hydrateCooccur, ensureFresh } = useTagCooccurStore();
  const { likedTags, blockedTags } = useTagFilterStore();
  const aggregate = useSearchSignalsStore((s) => s.aggregate);
  const getBoosts = useSearchClickStore((s) => s.getBoosts);
  const hydrateClicks = useSearchClickStore((s) => s.hydrate);

  useEffect(() => {
    void hydrateGraph();
    void hydrateCooccur();
    void ensureFresh();
    void hydrateClicks();
  }, [hydrateGraph, hydrateCooccur, ensureFresh, hydrateClicks]);

  const allTagsQ = useQuery({
    queryKey: ['all-tag-names-v3'],
    queryFn: fetchAllTagNames,
    staleTime: 5 * 60_000,
  });
  const trendingQ = useQuery({
    queryKey: ['trending-tag-names'],
    queryFn: fetchTrendingTagNames,
    staleTime: 5 * 60_000,
  });

  const signals = useMemo(() => aggregate(), [aggregate]);

  // N-gram インデックス
  const ngramIndex = useMemo(() => {
    const idx = new NgramIndex();
    for (const t of (allTagsQ.data ?? [])) idx.add(t);
    for (const n of Object.values(nodes)) {
      idx.add(n.label);
      for (const a of n.aliases) idx.add(a);
      for (const r of (n.related ?? [])) idx.add(r);
    }
    for (const t of Object.keys(tagPopularity)) idx.add(t);
    return idx;
  }, [allTagsQ.data, nodes, tagPopularity]);

  // Trie for prefix completion
  const trie = useMemo(() => {
    const t = new Trie();
    const entries: Array<{ tag: string; popularity: number }> = [];
    const allTags = new Set<string>(allTagsQ.data ?? []);
    for (const n of Object.values(nodes)) {
      allTags.add(n.label);
      for (const a of n.aliases) allTags.add(a);
    }
    for (const tag of allTags) {
      entries.push({ tag, popularity: tagPopularity[tag] ?? 0 });
    }
    t.build(entries);
    return t;
  }, [allTagsQ.data, nodes, tagPopularity]);

  // PMI Embeddings
  const embeddings = useMemo(() => buildEmbeddings(cooccur, tagPopularity), [cooccur, tagPopularity]);

  const trendingTags = useMemo(() => new Set(trendingQ.data ?? []), [trendingQ.data]);

  // search / predict / completions は呼び出し側で useMemo deps として使われるので
  // 参照を安定させる。以前は毎 render で新ハンドラを作成 → autocomplete useMemo が
  // キーストロークごとに無条件で再評価されていた (debounce 効かず)
  const search = useCallback(
    (query: string, limit = 12): V3Result[] => {
      const clickBoosts = getBoosts(query);
      const ctx: SearchV3Context = {
        ngramIndex,
        embeddings,
        nodes,
        cooccur,
        tagPopularity,
        likedTags,
        blockedTags,
        tagAffinity: signals.tagFreq,
        trendingTags,
        clickBoosts,
      };
      return searchTagsV3(query, ctx, { limit, diversify: true });
    },
    [ngramIndex, embeddings, nodes, cooccur, tagPopularity, likedTags, blockedTags, signals.tagFreq, trendingTags, getBoosts],
  );

  // Predict: Trie ベースの prefix completion (人気度順)
  const predict = useCallback(
    (query: string): string | null => {
      if (!query) return null;
      const completions = trie.completions(query, 1);
      if (completions.length === 0) return null;
      const top = completions[0]!.tag;
      if (top.toLowerCase() === query.toLowerCase()) return null;
      return top;
    },
    [trie],
  );

  // 上位 K の prefix 候補
  const completions = useCallback(
    (query: string, k = 5): string[] => {
      if (!query) return [];
      return trie.completions(query, k).map((c) => c.tag).filter((t) => t.toLowerCase() !== query.toLowerCase());
    },
    [trie],
  );

  // Context は外部からも参照可能に
  const ctx: SearchV3Context = useMemo(() => ({
    ngramIndex,
    embeddings,
    nodes,
    cooccur,
    tagPopularity,
    likedTags,
    blockedTags,
    tagAffinity: signals.tagFreq,
    trendingTags,
  }), [ngramIndex, embeddings, nodes, cooccur, tagPopularity, likedTags, blockedTags, signals.tagFreq, trendingTags]);

  return { ctx, search, predict, completions, isReady: !!allTagsQ.data };
}
