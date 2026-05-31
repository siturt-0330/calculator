import { useCallback, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { NgramIndex } from '../lib/search/ngramIndex';
import { buildEmbeddings } from '../lib/search/embeddings';
import { Trie } from '../lib/search/trie';
import { useTagGraphStore } from '../stores/tagGraphStore';
import { useTagCooccurStore } from '../stores/tagCooccurStore';
import { useTagFilterStore } from '../stores/tagFilterStore';
import { useSearchSignalsStore } from '../stores/searchSignalsStore';
import { useSearchClickStore } from '../stores/searchClickStore';
import { searchTagsV3, type V3Result, type SearchV3Context } from '../lib/search/tagSearchV3';

async function fetchAllTagNames(): Promise<string[]> {
  const { data } = await supabase
    .from('tags')
    .select('name')
    .order('member_count', { ascending: false })
    .limit(500);
  return (data ?? []).map((t: { name: string }) => t.name);
}

// Audit G#7 (2026-05): mv_trending_tags の 5 分毎 refresh (0071_trending_cron.sql)
// を入れたので、posts table の per-session 集計から MV 経由読み込みに切り替え。
// MV は内部で order by recent_count desc されているが、降順の保証のため改めて order 指定。
async function fetchTrendingTagNames(): Promise<string[]> {
  const { data } = await supabase
    .from('mv_trending_tags')
    .select('tag, recent_count')
    .gte('recent_count', 2) // 元実装と同じ閾値 (1 回しか出てないタグは除外)
    .order('recent_count', { ascending: false })
    .limit(30);
  return (data ?? [])
    .map((r: { tag: string | null }) => r.tag)
    .filter((t): t is string => !!t);
}

// ============================================================
// インデックスの module レベル共有メモ (perf)
// ------------------------------------------------------------
// useTagSearchV3 は投稿の Step 2 などで複数 component から同時に呼ばれる
// (例: <TagInputSuggestions> と useAutoTagSuggest)。各 instance が同一データから
// n-gram / trie / PMI embeddings を別々に二重構築していて初回マウントが重かった。
// タグデータはアプリ全体で 1 セットなので、入力参照が一致すれば構築結果を使い回す
// 単一スロットのメモを module レベルに置いて全 consumer で共有する。
// react-query / zustand は変化時のみ新しい参照を返すので ref 等価で安全に共有できる。
// ============================================================
function sharedSlotMemo<R>(): (key: readonly unknown[], build: () => R) => R {
  let slot: { key: readonly unknown[]; val: R } | null = null;
  return (key, build) => {
    if (slot && slot.key.length === key.length && slot.key.every((k, i) => Object.is(k, key[i]))) {
      return slot.val;
    }
    const val = build();
    slot = { key, val };
    return val;
  };
}
const _ngramMemo = sharedSlotMemo<NgramIndex>();
const _trieMemo = sharedSlotMemo<Trie>();
const _embedMemo = sharedSlotMemo<ReturnType<typeof buildEmbeddings>>();

export function useTagSearchV3() {
  // Field-scoped selectors — whole-store destructure was causing this hook
  // (consumed by autocomplete input) to re-build n-gram / trie / PMI indexes
  // whenever an unrelated store field changed.
  const nodes = useTagGraphStore((s) => s.nodes);
  const hydrateGraph = useTagGraphStore((s) => s.hydrate);
  const cooccur = useTagCooccurStore((s) => s.cooccur);
  const tagPopularity = useTagCooccurStore((s) => s.tagPopularity);
  const hydrateCooccur = useTagCooccurStore((s) => s.hydrate);
  const ensureFresh = useTagCooccurStore((s) => s.ensureFresh);
  const likedTags = useTagFilterStore((s) => s.likedTags);
  const blockedTags = useTagFilterStore((s) => s.blockedTags);
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
  const ngramIndex = useMemo(
    () =>
      _ngramMemo([allTagsQ.data, nodes, tagPopularity], () => {
        const idx = new NgramIndex();
        for (const t of (allTagsQ.data ?? [])) idx.add(t);
        for (const n of Object.values(nodes)) {
          idx.add(n.label);
          for (const a of n.aliases) idx.add(a);
          for (const r of (n.related ?? [])) idx.add(r);
        }
        for (const t of Object.keys(tagPopularity)) idx.add(t);
        return idx;
      }),
    [allTagsQ.data, nodes, tagPopularity],
  );

  // Trie for prefix completion
  const trie = useMemo(
    () =>
      _trieMemo([allTagsQ.data, nodes, tagPopularity], () => {
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
      }),
    [allTagsQ.data, nodes, tagPopularity],
  );

  // PMI Embeddings
  const embeddings = useMemo(
    () => _embedMemo([cooccur, tagPopularity], () => buildEmbeddings(cooccur, tagPopularity)),
    [cooccur, tagPopularity],
  );

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
