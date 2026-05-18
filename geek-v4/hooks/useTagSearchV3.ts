import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { NgramIndex } from '@/lib/search/ngramIndex';
import { buildEmbeddings } from '@/lib/search/embeddings';
import { useTagGraphStore } from '@/stores/tagGraphStore';
import { useTagCooccurStore } from '@/stores/tagCooccurStore';
import { useTagFilterStore } from '@/stores/tagFilterStore';
import { useSearchSignalsStore } from '@/stores/searchSignalsStore';
import { searchTagsV3, predictCompletion, type V3Result, type SearchV3Context } from '@/lib/search/tagSearchV3';

async function fetchAllTagNames(): Promise<string[]> {
  const { data } = await supabase
    .from('tags')
    .select('name')
    .order('member_count', { ascending: false })
    .limit(500);
  return (data ?? []).map((t: { name: string }) => t.name);
}

async function fetchTrendingTagNames(): Promise<string[]> {
  // 過去 24h の post から急上昇タグを抽出
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

  useEffect(() => {
    void hydrateGraph();
    void hydrateCooccur();
    void ensureFresh();
  }, [hydrateGraph, hydrateCooccur, ensureFresh]);

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

  // N-gram インデックスを構築 (allTags + graph labels + cooccur keys)
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

  // PMI Embeddings を構築 (キャッシュ)
  const embeddings = useMemo(() => buildEmbeddings(cooccur, tagPopularity), [cooccur, tagPopularity]);

  const trendingTags = useMemo(() => new Set(trendingQ.data ?? []), [trendingQ.data]);

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

  const search = (query: string, limit = 12): V3Result[] =>
    searchTagsV3(query, ctx, { limit, diversify: true });

  const predict = (query: string): string | null =>
    predictCompletion(query, ctx);

  return { ctx, search, predict, isReady: !!allTagsQ.data };
}
