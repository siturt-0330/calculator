import { useState, useEffect, useMemo, useRef } from 'react';
import { View, Text, ScrollView, ActivityIndicator, TextInput, Platform } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, interpolateColor } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { attachChannel } from '../lib/realtime';
import { fetchTrendingTags } from '../lib/api/trending';
import { TopBar } from '../components/nav/TopBar';
import { BackButton } from '../components/nav/BackButton';
import { PressableScale } from '../components/ui/PressableScale';
import { Avatar } from '../components/ui/Avatar';
import { HighlightedText } from '../components/ui/HighlightedText';
import { Icon } from '../constants/icons';
import { C, GRAD, R, SHADOW, SP } from '../design/tokens';
import { T } from '../design/typography';
import { TIMING_FAST } from '../design/motion';
import { formatRelative } from '../lib/utils/date';
import { useTagGraphStore } from '../stores/tagGraphStore';
import { useSearchHistoryStore } from '../stores/searchHistoryStore';
import { useSearchSignalsStore } from '../stores/searchSignalsStore';
import { useTagFilterStore } from '../stores/tagFilterStore';
import { useTagCooccurStore } from '../stores/tagCooccurStore';
import { findRelatedTags } from '../lib/search/tagVector';
import { parseQuery, type ParsedQuery } from '../lib/search/queryParser';
import { normalize, deepNormalize } from '../lib/search/tokenize';
import { scorePost, scoreTagItem, type PostDoc, type TagDoc } from '../lib/search/scoring';
import { findClosest, findClosestK } from '../lib/search/typoCorrect';
import { generateVariants, previewVariants } from '../lib/search/variants';
import { getAutocompleteSuggestions } from '../lib/search/autocomplete';
import { useLanguageStore } from '../stores/languageStore';
import { useSavedSearches, useCreateSavedSearch, useDeleteSavedSearch } from '../hooks/useSavedSearches';
import { useToastStore } from '../stores/toastStore';
import { logEvent } from '../lib/personalize';
import { useTagSearchV3 } from '../hooks/useTagSearchV3';
import { useSearchClickStore } from '../stores/searchClickStore';
import { generateRelatedQueries } from '../lib/search/relatedSearches';
import { expandWithTagGraph } from '../lib/utils/searchAlgo';
import { expandWithCooccur } from '../lib/tagClustering/relations';
import { classifyEntity } from '../lib/search/queryEntity';
import { ReasonBadges } from '../components/search/ReasonBadge';
import { DiscoverPhotoGrid } from '../components/search/DiscoverPhotoGrid';

type BBSResult = { id: string; title: string; category: string; replies_count: number; created_at: string };
type Category = 'all' | 'posts' | 'tags' | 'bbs';
type SortMode = 'relevance' | 'newest' | 'popular';

// Google 風の "all" ビュー: 各セクション max 3 件 + 「もっと見る」で展開
const PREVIEW_LIMIT = 3;

// ============= サーバー検索 =============
async function fetchTags(queries: string[]): Promise<TagDoc[]> {
  if (queries.length === 0) return [];
  const filters = queries.slice(0, 16).map((q) => `name.ilike.%${q}%`).join(',');
  const { data } = await supabase
    .from('tags')
    .select('name, post_count, member_count')
    .or(filters)
    .order('member_count', { ascending: false })
    .limit(60);
  return (data ?? []) as TagDoc[];
}

async function fetchAllTags(): Promise<string[]> {
  const { data } = await supabase
    .from('tags')
    .select('name')
    .order('member_count', { ascending: false })
    .limit(200);
  return (data ?? []).map((t: { name: string }) => t.name);
}

async function fetchPosts(queries: string[], tagFilters: string[]): Promise<PostDoc[]> {
  const map = new Map<string, PostDoc>();
  const SELECT = 'id, content, tag_names, likes_count, comments_count, concern_count, created_at, trust_score_at_post, media_urls, source_url, kind';

  // 本文検索
  if (queries.length > 0) {
    const filters = queries.slice(0, 16).map((q) => `content.ilike.%${q}%`).join(',');
    const { data } = await supabase
      .from('posts').select(SELECT).or(filters)
      .eq('is_anonymous', true).eq('is_public', true)
      .order('created_at', { ascending: false }).limit(80);
    for (const p of (data ?? []) as PostDoc[]) map.set(p.id, p);
  }
  // タグ overlap 検索
  const tagQueries = [...queries, ...tagFilters].filter(Boolean).slice(0, 12);
  if (tagQueries.length > 0) {
    const { data } = await supabase
      .from('posts').select(SELECT).overlaps('tag_names', tagQueries)
      .eq('is_anonymous', true).eq('is_public', true)
      .order('created_at', { ascending: false }).limit(80);
    for (const p of (data ?? []) as PostDoc[]) map.set(p.id, p);
  }
  return [...map.values()];
}

async function fetchBBS(q: string): Promise<BBSResult[]> {
  if (!q) return [];
  const { data } = await supabase
    .from('bbs_threads')
    .select('id, title, category, replies_count, created_at')
    .ilike('title', `%${q}%`)
    .order('last_reply_at', { ascending: false, nullsFirst: false })
    .limit(30);
  const rows = (data ?? []) as BBSResult[];
  // 同タイトル + 同カテゴリの重複を dedupe — seed data や bot クローンのスレッドが
  // 何個も並ぶのを防ぐ
  const seen = new Map<string, BBSResult>();
  for (const r of rows) {
    const key = `${(r.title || '').trim().toLowerCase()}|${r.category}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, r);
    } else {
      // 返信数が多い方を残す (より「活発な方」)
      if ((r.replies_count ?? 0) > (existing.replies_count ?? 0)) seen.set(key, r);
    }
  }
  return [...seen.values()];
}

const CATEGORY_LABELS: Record<Category, { label: string; emoji: string }> = {
  all: { label: 'すべて', emoji: '✨' },
  posts: { label: '投稿', emoji: '📝' },
  tags: { label: 'タグ', emoji: '#' },
  bbs: { label: '掲示板', emoji: '💬' },
};

const SORT_LABELS: Record<SortMode, { label: string; emoji: string }> = {
  relevance: { label: '関連度', emoji: '🎯' },
  newest: { label: '新着順', emoji: '🕐' },
  popular: { label: '人気順', emoji: '🔥' },
};

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [category, setCategory] = useState<Category>('all');
  const [sortMode, setSortMode] = useState<SortMode>('relevance');
  // Google 風: 'all' タブで各 section の「もっと見る」展開状態を持つ
  const [expandedPosts, setExpandedPosts] = useState(false);
  const [expandedTags, setExpandedTags] = useState(false);
  const [expandedBBS, setExpandedBBS] = useState(false);
  // 検索 input の focus 状態 (glow shadow / animated border 用)
  const [inputFocused, setInputFocused] = useState(false);
  const inputRef = useRef<TextInput | null>(null);
  // Infinite scroll prep — cursor / nextOffset for future paged fetches.
  // Reset on every new debounced query.
  const [, setNextOffset] = useState<number>(0);

  // 全 store destructure はキーストロークごとの toast / signal / cooccur 更新で
  // search.tsx 全体が再 render される原因。fields ごとに subscribe する。
  const nodes = useTagGraphStore((s) => s.nodes);
  const hydrateGraph = useTagGraphStore((s) => s.hydrate);
  const lang = useLanguageStore((s) => s.lang);
  const history = useSearchHistoryStore((s) => s.history);
  const hydrateHist = useSearchHistoryStore((s) => s.hydrate);
  const addHist = useSearchHistoryStore((s) => s.add);
  const removeHist = useSearchHistoryStore((s) => s.remove);
  const clearHist = useSearchHistoryStore((s) => s.clear);
  // 保存検索
  const { searches: savedSearches } = useSavedSearches();
  const { mutateAsync: createSavedSearchMut } = useCreateSavedSearch();
  const { mutateAsync: deleteSavedSearchMut } = useDeleteSavedSearch();
  const showToast = useToastStore((s) => s.show);
  const saveCurrentQuery = () => {
    if (!debounced.trim()) return;
    createSavedSearchMut({ query: debounced })
      .then(() => showToast('検索を保存しました', 'success'))
      .catch(() => showToast('保存に失敗しました', 'error'));
  };
  const removeSavedSearchFn = (id: string) => {
    deleteSavedSearchMut(id).catch(() => showToast('削除に失敗しました', 'error'));
  };
  const isCurrentSaved = useMemo(
    () => savedSearches.some((s) => s.query === debounced.trim()),
    [savedSearches, debounced],
  );
  const hydrateSignals = useSearchSignalsStore((s) => s.hydrate);
  const recordSignal = useSearchSignalsStore((s) => s.record);
  const aggregate = useSearchSignalsStore((s) => s.aggregate);
  const likedTags = useTagFilterStore((s) => s.likedTags);
  const blockedTags = useTagFilterStore((s) => s.blockedTags);
  const cooccur = useTagCooccurStore((s) => s.cooccur);
  const tagPopularity = useTagCooccurStore((s) => s.tagPopularity);
  const hydrateCooccur = useTagCooccurStore((s) => s.hydrate);
  const ensureCooccur = useTagCooccurStore((s) => s.ensureFresh);
  const likedSet = useMemo(() => new Set(likedTags), [likedTags]);
  const blockedSet = useMemo(() => new Set(blockedTags), [blockedTags]);

  useEffect(() => {
    void hydrateGraph();
    void hydrateHist();
    void hydrateSignals();
    void hydrateCooccur();
    void ensureCooccur();
  }, [hydrateGraph, hydrateHist, hydrateSignals, hydrateCooccur, ensureCooccur]);

  const signals = useMemo(() => aggregate(), [aggregate]);

  useEffect(() => {
    // 220ms → 150ms (体感応答性 up)
    // 短いクエリ (≤2 文字) は 100ms — autocomplete を爆速に
    const delay = q.trim().length <= 2 ? 100 : 150;
    const t = setTimeout(() => {
      const trimmed = q.trim();
      setDebounced(trimmed);
      // パーソナライズ用シグナル: 2 文字以上の本気のクエリだけ記録
      if (trimmed.length >= 2) {
        void logEvent({ kind: 'search_submit', tags: [trimmed], query: trimmed });
      }
    }, delay);
    return () => clearTimeout(t);
  }, [q]);

  // クエリパース
  const parsedQuery: ParsedQuery = useMemo(() => parseQuery(debounced), [debounced]);
  // タググラフからの拡張
  const expansion = useMemo(() => {
    const queries = [...parsedQuery.keywords, ...parsedQuery.tags];
    const out: { tag: string; reason: string }[] = [];
    for (const k of queries) {
      out.push(...expandWithTagGraph(k, nodes));
    }
    return out;
  }, [parsedQuery, nodes]);

  // 全検索クエリ (キーワード → variants[] + フレーズ + タググラフ)
  const variantsPerKeyword = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const kw of parsedQuery.keywords) {
      map[kw] = generateVariants(kw);
    }
    return map;
  }, [parsedQuery.keywords]);

  // ベクトル類似度 (共起 + 字面 + グラフ) で関連タグを発見
  const vectorRelated = useMemo(() => {
    if (parsedQuery.keywords.length === 0) return [] as { tag: string; score: number }[];
    const candidates = new Set<string>();
    for (const t of Object.keys(tagPopularity)) candidates.add(t);
    for (const n of Object.values(nodes)) {
      candidates.add(n.label);
      for (const a of n.aliases) candidates.add(a);
      for (const r of n.related ?? []) candidates.add(r);
    }
    const out: { tag: string; score: number }[] = [];
    for (const kw of parsedQuery.keywords) {
      const top = findRelatedTags(kw, [...candidates], { nodes, cooccur }, { topK: 10, minScore: 0.3 });
      out.push(...top);
    }
    // ユニーク化 (高 score 優先)
    const map = new Map<string, { tag: string; score: number }>();
    for (const r of out) {
      const prev = map.get(r.tag);
      if (!prev || r.score > prev.score) map.set(r.tag, r);
    }
    return [...map.values()].sort((a, b) => b.score - a.score).slice(0, 12);
  }, [parsedQuery, nodes, cooccur, tagPopularity]);

  const allQueries = useMemo(() => {
    const set = new Set<string>();
    for (const variants of Object.values(variantsPerKeyword)) {
      for (const v of variants) set.add(v);
    }
    for (const p of parsedQuery.phrases) {
      for (const v of generateVariants(p)) set.add(v);
    }
    for (const e of expansion) set.add(normalize(e.tag));
    // ベクトル類似度上位もクエリに追加
    for (const r of vectorRelated.slice(0, 6)) set.add(normalize(r.tag));
    // 短すぎる variants (1文字) は重複・誤マッチを増やすので除外
    return [...set].filter((x) => x.length >= 2);
  }, [variantsPerKeyword, parsedQuery, expansion, vectorRelated]);

  // Phase 2: cluster cooccur primitive — vectorRelated/expansion で取りこぼした
  // 純粋な共起ペアも拡張集合に追加 (e.g. graph に無いがよく一緒に投稿される)。
  const cooccurExpanded = useMemo(() => {
    const inputs = [...parsedQuery.keywords, ...parsedQuery.tags];
    if (inputs.length === 0) return [] as { tag: string; score: number }[];
    return expandWithCooccur(inputs, cooccur, { topK: 12, minCount: 3 });
  }, [parsedQuery, cooccur]);

  const expandedTagSet = useMemo(() => {
    const s = new Set(expansion.map((e) => e.tag));
    for (const r of vectorRelated) s.add(r.tag);
    for (const r of cooccurExpanded) s.add(r.tag);
    return s;
  }, [expansion, vectorRelated, cooccurExpanded]);

  // Phase 4: クエリ意味解釈 (entity / modifiers / relatedEntities)
  // knownTagSet は「我々がタグとして認識しているもの全部」 — cooccur + popularity + graph
  // ノードの label / alias を deepNormalize で正規化した集合。
  // ここに query の keyword が当たれば「これは entity (対象タグ) だ」 と判断する。
  const knownTagSet = useMemo(() => {
    const s = new Set<string>();
    for (const k of Object.keys(tagPopularity)) {
      const n = deepNormalize(k);
      if (n) s.add(n);
    }
    for (const k of Object.keys(cooccur)) {
      const n = deepNormalize(k);
      if (n) s.add(n);
    }
    for (const node of Object.values(nodes)) {
      const ln = deepNormalize(node.label);
      if (ln) s.add(ln);
      for (const a of node.aliases) {
        const an = deepNormalize(a);
        if (an) s.add(an);
      }
    }
    return s;
  }, [tagPopularity, cooccur, nodes]);

  const queryEntity = useMemo(
    () => classifyEntity(parsedQuery, knownTagSet, { cooccur, relatedTopK: 6 }),
    [parsedQuery, knownTagSet, cooccur],
  );

  // クエリ全 variants をマージ (スコアリング & ハイライト用)
  const allVariantQueries: ParsedQuery = useMemo(() => {
    const keywords = new Set<string>();
    for (const variants of Object.values(variantsPerKeyword)) {
      for (const v of variants) keywords.add(v);
    }
    return { ...parsedQuery, keywords: [...keywords] };
  }, [parsedQuery, variantsPerKeyword]);

  // データ取得
  const allTagsQ = useQuery({
    queryKey: ['all-tag-names'],
    queryFn: fetchAllTags,
    staleTime: 60_000,
  });

  const tagsQ = useQuery({
    queryKey: ['search-tags-v3', allQueries.join('|')],
    queryFn: () => fetchTags(allQueries),
    enabled: debounced.length > 0,
  });

  const postsQ = useQuery({
    queryKey: ['search-posts-v3', allQueries.join('|'), parsedQuery.tags.join('|')],
    queryFn: () => fetchPosts(allQueries, parsedQuery.tags),
    enabled: debounced.length > 0,
  });

  const bbsQ = useQuery({
    queryKey: ['search-bbs-v3', debounced],
    queryFn: () => fetchBBS(parsedQuery.keywords.join(' ')),
    enabled: debounced.length > 0 && parsedQuery.keywords.length > 0,
  });

  // 加速度ベースのトレンドタグ取得 (scorePost の trendingTags ctx 用)
  const trendingAccel = useQuery({
    queryKey: ['search-trending-accel'],
    queryFn: () => fetchTrendingTags(20),
    staleTime: 5 * 60 * 1000,
  });

  // isSpike === true OR acceleration > 0 のタグ名 Set
  const trendingTagSet = useMemo(() => {
    const s = new Set<string>();
    for (const t of trendingAccel.data ?? []) {
      if (t.isSpike || t.acceleration > 0) s.add(t.name);
    }
    return s;
  }, [trendingAccel.data]);

  // Cold-start: 好きなタグ < 3 かつ クエリ履歴 < 5
  const coldStartMode = useMemo(
    () => likedTags.length < 3 && history.length < 5,
    [likedTags, history],
  );

  // パーソナライゼーション + スコアリング
  const ctx = useMemo(() => ({
    likedTags: likedSet,
    blockedTags: blockedSet,
    recentQueries: history,
    tagAffinity: signals.tagFreq,
    recentTags: signals.recentTags,
    trendingTags: trendingTagSet,
    coldStartMode,
    // Phase 4: scoring に entity / relatedEntities boost を渡す
    queryEntity,
  }), [likedSet, blockedSet, history, signals, trendingTagSet, coldStartMode, queryEntity]);

  const rankedPosts = useMemo(() => {
    const scored = (postsQ.data ?? [])
      .map((p) => ({ item: p, ...scorePost(p, allVariantQueries, expandedTagSet, ctx) }))
      .filter((r) => r.score > 0);

    if (sortMode === 'newest') scored.sort((a, b) => new Date(b.item.created_at).getTime() - new Date(a.item.created_at).getTime());
    else if (sortMode === 'popular') scored.sort((a, b) => (b.item.likes_count + b.item.comments_count) - (a.item.likes_count + a.item.comments_count));
    else scored.sort((a, b) => b.score - a.score);

    // 内容ベースの dedupe — 同じ content + 同じ tag セットの重複投稿を 1 つに
    // (seed data 由来の同文重複 / botクローン投稿対策)
    // 上位スコアを残す方針なので、ソート後に dedupe する
    const seen = new Map<string, typeof scored[0]>();
    for (const r of scored) {
      // 内容の最初の 80 文字 + tags の sorted hash で de-dup key を作る
      const contentKey = normalize(r.item.content.slice(0, 80));
      const tagKey = (r.item.tag_names ?? []).slice().sort().join(',');
      const key = `${contentKey}|${tagKey}`;
      if (!seen.has(key)) seen.set(key, r);
      else {
        // 既存より新しいなら入れ替え (new sort 時の挙動を尊重)
        const existing = seen.get(key)!;
        if (sortMode === 'newest' && new Date(r.item.created_at).getTime() > new Date(existing.item.created_at).getTime()) {
          seen.set(key, r);
        }
      }
    }
    return [...seen.values()].slice(0, 50);
  }, [postsQ.data, allVariantQueries, expandedTagSet, ctx, sortMode]);

  const rankedTags = useMemo(() => {
    const scored = (tagsQ.data ?? [])
      .map((t) => ({ item: t, ...scoreTagItem(t, allVariantQueries, expandedTagSet, ctx) }))
      .filter((r) => r.score > 0);
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 30);
  }, [tagsQ.data, allVariantQueries, expandedTagSet, ctx]);

  // Did you mean? (上位タグから)
  const suggestion = useMemo(() => {
    if (rankedTags.length > 0 || debounced.length < 2) return null;
    if (!allTagsQ.data) return null;
    const kw = parsedQuery.keywords[0];
    if (!kw) return null;
    return findClosest(kw, allTagsQ.data, 0.55);
  }, [rankedTags, debounced, parsedQuery, allTagsQ.data]);

  // オートコンプリート: V3 エンジン
  const { ctx: v3Ctx, search: tagSearchV3, predict: predictV3 } = useTagSearchV3();
  const recordClick = useSearchClickStore((s) => s.record);
  const clickStats = useSearchClickStore((s) => s.queryToTagCount);
  const recentInLastHour = useSearchHistoryStore((s) => s.recentInLastHour);

  // 関連検索 (Google "Related searches")
  const relatedQueries = useMemo(() => {
    if (!debounced.trim()) return [];
    return generateRelatedQueries(debounced, {
      nodes: v3Ctx.nodes,
      cooccur: v3Ctx.cooccur,
      embeddings: v3Ctx.embeddings,
      clickStats,
    }, 6);
  }, [debounced, v3Ctx.nodes, v3Ctx.cooccur, v3Ctx.embeddings, clickStats]);

  // 直近1時間に検索したクエリ
  const hourlyRecent = useMemo(() => recentInLastHour().slice(0, 5), [recentInLastHour]);
  const autocomplete = useMemo(() => {
    if (q.trim().length < 1) return [];
    const lastToken = q.trim().split(/\s+/).pop() || '';
    if (lastToken.length < 1) return [];
    const results = tagSearchV3(lastToken, 8);
    return results.map((r) => r.tag);
  }, [q, tagSearchV3]);

  // Ghost typeahead: アニ → アニメ を予測
  const ghostPrediction = useMemo(() => {
    if (q.trim().length < 1) return null;
    const lastToken = q.trim().split(/\s+/).pop() || '';
    if (lastToken.length < 1) return null;
    const pred = predictV3(lastToken);
    if (!pred || pred === lastToken) return null;
    // 元クエリの prefix を保ちつつ、続きを ghost で表示
    const lower = lastToken.toLowerCase();
    if (!pred.toLowerCase().startsWith(lower)) return null;
    return { full: pred, suffix: pred.slice(lastToken.length) };
  }, [q, predictV3]);

  // バリアントプレビュー (Google 風: "ポケモン も検索しています")
  const variantPreview = useMemo(() => {
    if (q.trim().length < 1) return [];
    return previewVariants(q.trim(), lang, 4);
  }, [q, lang]);

  const moreSuggestions = useMemo(() => {
    if (!allTagsQ.data) return [];
    const kw = parsedQuery.keywords[0];
    if (!kw) return [];
    return findClosestK(kw, allTagsQ.data, 4, 0.45);
  }, [parsedQuery, allTagsQ.data]);

  // 検索 commit — Enter で即時 flush + history 追加
  const commit = () => {
    const trimmed = q.trim();
    if (!trimmed) return;
    // debounce を待たずに即時反映 (mobile では入力中の Enter で爆速検索 UX)
    if (trimmed !== debounced) setDebounced(trimmed);
    addHist(trimmed);
  };

  // Reset pagination cursor whenever the active query changes.
  // 同時に「もっと見る」の展開状態も resetする (新クエリは初期 preview から見せる)
  useEffect(() => {
    setNextOffset(0);
    setExpandedPosts(false);
    setExpandedTags(false);
    setExpandedBBS(false);
  }, [debounced]);

  // 検索入力 focus を Reanimated で滑らかに遷移 (border + halo)
  const focusProgress = useSharedValue(0);
  useEffect(() => {
    focusProgress.value = withTiming(inputFocused ? 1 : 0, TIMING_FAST);
  }, [inputFocused, focusProgress]);
  const aSearchBorder = useAnimatedStyle(() => ({
    borderColor: interpolateColor(
      focusProgress.value,
      [0, 1],
      ['rgba(255,255,255,0.08)', C.accent],
    ),
  }));

  // Realtime: subscribe to new posts whose tag_names intersect the current query.
  // Cap = 1 channel per screen — we detach the previous channel before attaching the next.
  useEffect(() => {
    if (!debounced) return;
    // 比較用に小文字化したキーワード/タグ set
    const matchTerms = new Set<string>();
    for (const k of parsedQuery.keywords) if (k) matchTerms.add(k.toLowerCase());
    for (const t of parsedQuery.tags) if (t) matchTerms.add(t.toLowerCase());
    if (matchTerms.size === 0) return;

    // Channel 名は query で一意化 (前 channel は cleanup で detach されるので常に最大1)
    const safeKey = debounced.slice(0, 64).replace(/[^a-zA-Z0-9_-]/g, '_');
    const channelName = `search-live:${safeKey}`;

    const detach = attachChannel(channelName, (ch) =>
      ch.on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'posts' },
        (payload) => {
          const row = payload.new as { tag_names?: string[] | null } | undefined;
          const tags = row?.tag_names ?? [];
          let hit = false;
          for (const tag of tags) {
            if (!tag) continue;
            if (matchTerms.has(tag.toLowerCase())) { hit = true; break; }
          }
          if (hit) {
            // 現在の検索キャッシュを無効化 — 次回 render で再フェッチされる
            qc.invalidateQueries({ queryKey: ['search-posts-v3'] });
          }
        },
      ),
    );
    return () => {
      detach();
    };
  }, [debounced, parsedQuery, qc]);

  // ハイライト用のターム
  const highlightTerms = useMemo(
    () => [...parsedQuery.keywords, ...parsedQuery.phrases, ...parsedQuery.tags].filter((t) => t.length > 0),
    [parsedQuery],
  );

  const trending = useQuery({
    queryKey: ['trending-tags'],
    queryFn: async () => {
      const { data } = await supabase
        .from('tags')
        .select('name, post_count, member_count')
        .order('member_count', { ascending: false })
        .limit(12);
      return (data ?? []) as TagDoc[];
    },
    // TrendingRow と共有 — 5 分は信用する (一覧画面横断で重複 fetch 削減)
    staleTime: 5 * 60_000,
  });

  // Fallback autocomplete: V3 tag engine が候補を出せなかった時に
  // history + popular tags でカバーする (lib/search/autocomplete 経由)
  const fallbackSuggestions = useMemo(() => {
    if (q.trim().length < 1) return [];
    const popularTags = (trending.data ?? []).map((t) => ({
      name: t.name,
      count: t.member_count,
    }));
    return getAutocompleteSuggestions(
      q.trim().split(/\s+/).pop() ?? '',
      {
        history,
        popularTags,
        existingTagSuggestions: autocomplete,
      },
      5,
    );
  }, [q, history, trending.data, autocomplete]);

  const loading = tagsQ.isLoading || postsQ.isLoading || bbsQ.isLoading;
  const showResults = debounced.length > 0;
  const totalResults = rankedPosts.length + rankedTags.length + (bbsQ.data?.length ?? 0);
  const showPosts = category === 'all' || category === 'posts';
  const showTags = category === 'all' || category === 'tags';
  const showBBS = category === 'all' || category === 'bbs';

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="検索" left={<BackButton />} />

      {/* 検索入力 + クエリチップ */}
      <View style={{ paddingHorizontal: SP['4'], paddingTop: SP['3'], gap: SP['2'] }}>
        {/* prominent glass search bar — focus 時に accent border + halo */}
        <Animated.View
          style={[
            {
              flexDirection: 'row',
              alignItems: 'center',
              gap: SP['2'],
              paddingHorizontal: SP['4'],
              paddingVertical: 10,
              // 半透明 glass 風 surface — Native は subtle blur 風、Web は rgba で十分
              backgroundColor: C.bg2,
              borderRadius: R.full,
              borderWidth: 1.5,
            },
            aSearchBorder,
            // focus 中: 紫 glow shadow を盛る (Native は SHADOW.glow, Web は CSS halo)
            inputFocused ? SHADOW.glow : SHADOW.sm,
            Platform.OS === 'web' && inputFocused
              ? // RN-web は box-shadow を直接通す
                ({ boxShadow: '0 0 0 4px rgba(124,106,247,0.22)' } as object)
              : null,
          ]}
        >
          <Icon.search
            size={20}
            color={inputFocused ? C.accent : C.text3}
            strokeWidth={2.2}
          />
          <View style={{ flex: 1, position: 'relative', justifyContent: 'center' }}>
            <TextInput
              ref={inputRef}
              value={q}
              onChangeText={setQ}
              placeholder="タグ・投稿・掲示板を検索"
              placeholderTextColor={C.text3}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              onSubmitEditing={commit}
              returnKeyType="search"
              blurOnSubmit={false}
              autoFocus
              autoCorrect={false}
              autoCapitalize="none"
              keyboardAppearance="dark"
              selectionColor={C.accent}
              cursorColor={C.accent}
              accessibilityLabel="検索キーワード入力"
              style={[T.body, { color: C.text, paddingVertical: 0 }]}
            />
            {/* ゴースト予測補完 */}
            {ghostPrediction && (
              <View pointerEvents="none" style={{
                position: 'absolute',
                left: 0, top: 0, right: 0, bottom: 0,
                flexDirection: 'row',
                alignItems: 'center',
              }}>
                <Text style={[T.body, { color: 'transparent', paddingVertical: 0 }]} numberOfLines={1}>
                  {q}
                  <Text style={{ color: C.text3 }}>{ghostPrediction.suffix}</Text>
                </Text>
              </View>
            )}
          </View>
          {q.length > 0 && (
            <PressableScale
              onPress={() => { setQ(''); setDebounced(''); inputRef.current?.focus(); }}
              haptic="tap"
              hitSlop={10}
              accessibilityLabel="入力をクリア"
              accessibilityRole="button"
              style={{
                width: 24, height: 24, borderRadius: 12,
                alignItems: 'center', justifyContent: 'center',
                backgroundColor: C.bg4,
              }}
            >
              <Icon.close size={14} color={C.text2} strokeWidth={2.4} />
            </PressableScale>
          )}
        </Animated.View>

        {/* 保存ボタン (検索中) — アイコン付きで意図を明確化 */}
        {debounced.trim().length > 0 && (
          <PressableScale
            onPress={saveCurrentQuery}
            haptic="confirm"
            disabled={isCurrentSaved}
            hitSlop={6}
            accessibilityLabel={isCurrentSaved ? '保存済みの検索' : 'この検索を保存'}
            accessibilityRole="button"
            style={{
              alignSelf: 'flex-start',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: SP['3'], paddingVertical: 6,
              backgroundColor: isCurrentSaved ? C.accentBg : C.accent,
              borderRadius: R.full,
              borderWidth: 1,
              borderColor: isCurrentSaved ? C.accent + '55' : 'transparent',
            }}
          >
            <Text style={{ fontSize: 12 }}>{isCurrentSaved ? '⭐' : '☆'}</Text>
            <Text style={[T.caption, { color: isCurrentSaved ? C.accent : '#fff', fontWeight: '700' }]}>
              {isCurrentSaved ? '保存済み' : 'この検索を保存'}
            </Text>
          </PressableScale>
        )}

        {/* 保存検索一覧 (検索無し時のみ) */}
        {!debounced.trim() && savedSearches.length > 0 && (
          <View style={{ gap: SP['1'] }}>
            <Text style={[T.smallM, { color: C.text3, letterSpacing: 0.5 }]}>保存した検索</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {savedSearches.map((s) => (
                <View key={s.id} style={{
                  flexDirection: 'row', alignItems: 'center', gap: 4,
                  paddingHorizontal: SP['2'], paddingVertical: 4,
                  backgroundColor: C.accentBg, borderRadius: R.full,
                  borderWidth: 1, borderColor: C.accentSoft,
                }}>
                  <PressableScale onPress={() => { setQ(s.query); setDebounced(s.query); }} haptic="tap">
                    <Text style={[T.caption, { color: C.accentLight, fontWeight: '700' }]}>★ {s.query}</Text>
                  </PressableScale>
                  <PressableScale onPress={() => removeSavedSearchFn(s.id)} haptic="warn">
                    <Text style={{ fontSize: 10, color: C.text3 }}>✕</Text>
                  </PressableScale>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* バリアントプレビュー: アルファベット入力時に日本語変換を表示 */}
        {variantPreview.length > 0 && (
          <View style={{
            flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6,
          }}>
            {variantPreview.map((v) => (
              <PressableScale
                key={v}
                onPress={() => { setQ(v); setDebounced(v); addHist(v); }}
                haptic="select"
                style={{
                  paddingHorizontal: SP['2'], paddingVertical: 3,
                  backgroundColor: C.accentBg,
                  borderRadius: R.full,
                  borderWidth: 1, borderColor: C.accentSoft,
                }}
              >
                <Text style={{ fontSize: 11, color: C.accentLight, fontWeight: '700' }}>
                  → {v}
                </Text>
              </PressableScale>
            ))}
          </View>
        )}

        {/* オートコンプリート候補 — Google 風: 🕐 履歴 / 🔍 タグ / # 人気 + ↖ 入力欄に取り込む */}
        {(autocomplete.length > 0 || fallbackSuggestions.length > 0) && q.length > 0 && (
          <View style={[
            {
              backgroundColor: C.bg2,
              borderRadius: R.lg,
              borderWidth: 1,
              borderColor: C.border,
              overflow: 'hidden',
            },
            SHADOW.md,
          ]}>
            {autocomplete.map((name, idx) => {
              // 過去に検索 / クリックされていれば「履歴」アイコン (🕐) で示す
              const inHistory = history.includes(name);
              const clickedBefore = (clickStats[q.trim()] ?? {})[name] !== undefined && clickStats[q.trim()]![name]! > 0;
              const seen = inHistory || clickedBefore;
              const isLast = idx === autocomplete.length - 1 && fallbackSuggestions.length === 0;
              return (
                <View
                  key={`v3:${name}`}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: SP['3'],
                    paddingVertical: SP['2'] + 2,
                    borderBottomWidth: isLast ? 0 : 1,
                    borderBottomColor: C.border + '40',
                  }}
                >
                  {/* 左: 履歴 or タグアイコン */}
                  {seen ? (
                    <Icon.clock size={16} color={C.text3} strokeWidth={2} />
                  ) : (
                    <Icon.hash size={16} color={C.accent} strokeWidth={2} />
                  )}
                  {/* 中: タグ名 — タップで実検索 */}
                  <PressableScale
                    onPress={() => {
                      recordClick(q.trim(), name);
                      setQ(name);
                      setDebounced(name);
                      addHist(name);
                    }}
                    haptic="select"
                    hitSlop={4}
                    accessibilityLabel={`${name} で検索`}
                    accessibilityRole="button"
                    style={{ flex: 1, paddingHorizontal: SP['2'], paddingVertical: 4 }}
                  >
                    <Text style={[T.smallM, { color: C.text }]}>#{name}</Text>
                  </PressableScale>
                  {/* 右: ↖ 入力欄に取り込む (検索はせず、編集を続ける) */}
                  <PressableScale
                    onPress={() => setQ(name)}
                    haptic="tap"
                    hitSlop={8}
                    accessibilityLabel={`${name} を入力欄に取り込む`}
                    style={{ padding: 4 }}
                  >
                    <Icon.arrowUL size={18} color={C.text3} strokeWidth={2} />
                  </PressableScale>
                </View>
              );
            })}
            {/* fallback: lib/search/autocomplete (history + popular tag merge) */}
            {fallbackSuggestions.map((item, idx) => {
              const isLast = idx === fallbackSuggestions.length - 1;
              const IconC = item.kind === 'history' ? Icon.clock : Icon.sparkles;
              const iconColor = item.kind === 'history' ? C.text3 : C.accentLight;
              return (
                <View
                  key={`fb:${item.kind}:${item.text}`}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: SP['3'],
                    paddingVertical: SP['2'] + 2,
                    borderBottomWidth: isLast ? 0 : 1,
                    borderBottomColor: C.border + '40',
                  }}
                >
                  <IconC size={16} color={iconColor} strokeWidth={2} />
                  <PressableScale
                    onPress={() => {
                      setQ(item.text);
                      setDebounced(item.text);
                      addHist(item.text);
                    }}
                    haptic="select"
                    hitSlop={4}
                    accessibilityLabel={`${item.text} で検索`}
                    accessibilityRole="button"
                    style={{ flex: 1, paddingHorizontal: SP['2'], paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 6 }}
                  >
                    <Text style={[T.smallM, { color: C.text, flex: 1 }]} numberOfLines={1}>
                      {item.text}
                    </Text>
                    {item.detail && (
                      <Text style={[T.caption, { color: C.text3 }]}>
                        {item.detail}
                      </Text>
                    )}
                  </PressableScale>
                  <PressableScale
                    onPress={() => setQ(item.text)}
                    haptic="tap"
                    hitSlop={8}
                    accessibilityLabel={`${item.text} を入力欄に取り込む`}
                    style={{ padding: 4 }}
                  >
                    <Icon.arrowUL size={18} color={C.text3} strokeWidth={2} />
                  </PressableScale>
                </View>
              );
            })}
          </View>
        )}

        {/* カテゴリタブ + ソート (検索中のみ) */}
        {showResults && (
          <View style={{ gap: SP['2'] }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {(Object.keys(CATEGORY_LABELS) as Category[]).map((c) => {
                  const active = category === c;
                  const meta = CATEGORY_LABELS[c];
                  const cnt = c === 'posts' ? rankedPosts.length
                    : c === 'tags' ? rankedTags.length
                    : c === 'bbs' ? (bbsQ.data?.length ?? 0)
                    : totalResults;
                  return (
                    <PressableScale
                      key={c}
                      onPress={() => setCategory(c)}
                      haptic="select"
                      accessibilityState={{ selected: active }}
                      style={{
                        flexDirection: 'row', alignItems: 'center', gap: 4,
                        paddingHorizontal: SP['3'], paddingVertical: 7,
                        // active: 紫 accentBg + 紫 border (柔らかい "選択中" 表現)
                        // inactive: glass-like bg2 + subtle border
                        backgroundColor: active ? C.accentBg : C.bg2,
                        borderRadius: R.full,
                        borderWidth: 1,
                        borderColor: active ? C.accent : C.border,
                      }}
                    >
                      <Text style={{ fontSize: 11 }}>{meta.emoji}</Text>
                      <Text style={[T.caption, { color: active ? C.accentLight : C.text, fontWeight: '700' }]}>
                        {meta.label}
                      </Text>
                      <View style={{
                        paddingHorizontal: 5, paddingVertical: 1,
                        backgroundColor: active ? C.accent : C.bg4,
                        borderRadius: R.sm,
                      }}>
                        <Text style={{ fontSize: 9, color: active ? '#fff' : C.text3, fontWeight: '700' }}>
                          {cnt}
                        </Text>
                      </View>
                    </PressableScale>
                  );
                })}
              </View>
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {(Object.keys(SORT_LABELS) as SortMode[]).map((s) => {
                  const active = sortMode === s;
                  const meta = SORT_LABELS[s];
                  return (
                    <PressableScale
                      key={s}
                      onPress={() => setSortMode(s)}
                      haptic="tap"
                      style={{
                        flexDirection: 'row', alignItems: 'center', gap: 3,
                        paddingHorizontal: 8, paddingVertical: 4,
                        backgroundColor: active ? C.accentBg : 'transparent',
                        borderRadius: R.full,
                        borderWidth: 1, borderColor: active ? C.accent : C.border,
                      }}
                    >
                      <Text style={{ fontSize: 10 }}>{meta.emoji}</Text>
                      <Text style={[T.caption, { color: active ? C.accentLight : C.text2, fontWeight: '600' }]}>
                        {meta.label}
                      </Text>
                    </PressableScale>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        )}
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: SP['4'],
          paddingBottom: insets.bottom + SP['10'],
          gap: SP['4'],
        }}
        keyboardShouldPersistTaps="handled"
      >
        {!showResults ? (
          <View style={{ gap: SP['4'] }}>
            {/* 直近1時間の検索 */}
            {hourlyRecent.length > 0 && (
              <View style={{ gap: SP['2'] }}>
                <Text style={[T.smallM, { color: C.text3, letterSpacing: 0.5 }]}>直近1時間</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
                  {hourlyRecent.map((h) => (
                    <PressableScale
                      key={h}
                      onPress={() => { setQ(h); setDebounced(h); }}
                      haptic="tap"
                      style={{
                        paddingHorizontal: SP['3'], paddingVertical: 6,
                        backgroundColor: C.bg3, borderRadius: R.full,
                        borderWidth: 1, borderColor: C.border,
                        flexDirection: 'row', alignItems: 'center', gap: 4,
                      }}
                    >
                      <Text style={{ fontSize: 10 }}>↺</Text>
                      <Text style={[T.smallM, { color: C.text }]}>{h}</Text>
                    </PressableScale>
                  ))}
                </View>
              </View>
            )}

            {/* 検索履歴 */}
            {history.length > 0 ? (
              <View style={{ gap: SP['2'] }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={[T.smallM, { color: C.text3, letterSpacing: 0.5 }]}>履歴</Text>
                  <PressableScale onPress={clearHist} haptic="warn" hitSlop={6}>
                    <Text style={[T.caption, { color: C.text3 }]}>消去</Text>
                  </PressableScale>
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
                  {history.map((h) => (
                    <View key={h} style={{
                      flexDirection: 'row', alignItems: 'center', gap: 4,
                      paddingHorizontal: SP['3'], paddingVertical: 6,
                      backgroundColor: C.bg3, borderRadius: R.full,
                      borderWidth: 1, borderColor: C.border,
                    }}>
                      <PressableScale onPress={() => setQ(h)} haptic="tap" hitSlop={4}>
                        <Text style={[T.smallM, { color: C.text }]}>🕐 {h}</Text>
                      </PressableScale>
                      <PressableScale onPress={() => removeHist(h)} haptic="warn" style={{ padding: 2 }} hitSlop={6}>
                        <Text style={{ fontSize: 11, color: C.text3 }}>✕</Text>
                      </PressableScale>
                    </View>
                  ))}
                </View>
              </View>
            ) : !savedSearches.length && (
              // ⭐ 履歴も保存検索もまだ無い真っさらユーザー — gradient circle + CTA で
              // 「ここで何が出来るか」を一目で伝える
              <View style={{
                alignItems: 'center',
                paddingVertical: SP['6'],
                paddingHorizontal: SP['4'],
                gap: SP['3'],
              }}>
                <View style={{
                  borderRadius: 48,
                  ...SHADOW.glow,
                }}>
                  <LinearGradient
                    colors={GRAD.primary}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={{
                      width: 96, height: 96, borderRadius: 48,
                      alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <Icon.search size={42} color="#fff" strokeWidth={2.2} />
                  </LinearGradient>
                </View>
                <Text style={[T.h3, { color: C.text, textAlign: 'center' }]}>
                  何でも検索しよう
                </Text>
                <Text style={[T.small, { color: C.text2, textAlign: 'center', maxWidth: 320, lineHeight: 20 }]}>
                  タグ・投稿・掲示板を一気に検索。{'\n'}
                  半角/全角・カタカナ/ひらがな・読み方の違いも自動で吸収します。
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
                  {['ホロライブ', 'ぽけもん', 'ｲｺﾗﾌﾞ'].map((ex) => (
                    <PressableScale
                      key={ex}
                      onPress={() => { setQ(ex); setDebounced(ex); addHist(ex); }}
                      haptic="tap"
                      style={{
                        paddingHorizontal: SP['3'], paddingVertical: 6,
                        backgroundColor: C.accentBg,
                        borderRadius: R.full,
                        borderWidth: 1, borderColor: C.accent + '55',
                      }}
                    >
                      <Text style={[T.caption, { color: C.accentLight, fontWeight: '700' }]}>
                        {ex}
                      </Text>
                    </PressableScale>
                  ))}
                </View>
              </View>
            )}

            {/* 人気タグ */}
            <View style={{ gap: SP['2'] }}>
              <Text style={[T.smallM, { color: C.text3, letterSpacing: 0.5 }]}>人気のタグ</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
                {trending.data?.map((tg) => (
                  <PressableScale
                    key={tg.name}
                    onPress={() => router.push(`/tag/${encodeURIComponent(tg.name)}` as never)}
                    haptic="tap"
                    style={{
                      paddingHorizontal: SP['3'], paddingVertical: SP['2'],
                      backgroundColor: C.bg2, borderRadius: R.full,
                      borderWidth: 1, borderColor: C.border,
                    }}
                  >
                    <Text style={[T.smallM, { color: C.text }]}>
                      #{tg.name}
                      <Text style={[T.caption, { color: C.text3 }]}> · {tg.member_count.toLocaleString('ja-JP')}</Text>
                    </Text>
                  </PressableScale>
                ))}
              </View>
            </View>

            {/* 写真で発見 (Instagram 風 3 列グリッド) */}
            <DiscoverPhotoGrid />
          </View>
        ) : loading ? (
          <View style={{ padding: SP['8'], alignItems: 'center' }}>
            <ActivityIndicator color={C.accent} />
          </View>
        ) : (
          <>
            {/* 関連検索 */}
            {relatedQueries.length > 0 && (
              <View style={{ gap: SP['2'] }}>
                <Text style={[T.smallM, { color: C.text3, letterSpacing: 0.5 }]}>関連</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {relatedQueries.map((r) => (
                    <PressableScale
                      key={r.query}
                      onPress={() => { setQ(r.query); setDebounced(r.query); addHist(r.query); }}
                      haptic="tap"
                      style={{
                        paddingHorizontal: SP['3'], paddingVertical: 6,
                        backgroundColor: C.bg2,
                        borderRadius: R.full,
                        borderWidth: 1, borderColor: C.border,
                      }}
                    >
                      <Text style={[T.smallM, { color: C.text }]}>{r.query}</Text>
                    </PressableScale>
                  ))}
                </View>
              </View>
            )}

            {/* Did you mean */}
            {suggestion && (
              <View style={{
                padding: SP['3'],
                backgroundColor: 'rgba(245,179,66,0.13)',
                borderRadius: R.md,
                borderWidth: 1, borderColor: 'rgba(245,179,66,0.4)',
                gap: SP['1'],
              }}>
                <Text style={[T.caption, { color: '#F5B342', fontWeight: '700' }]}>
                  もしかして…?
                </Text>
                <PressableScale onPress={() => setQ(suggestion)} haptic="confirm">
                  <Text style={[T.bodyMd, { color: '#F5B342', fontWeight: '800' }]}>
                    🔎 {suggestion}
                  </Text>
                </PressableScale>
                {moreSuggestions.filter((s) => s !== suggestion).length > 0 && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                    {moreSuggestions.filter((s) => s !== suggestion).slice(0, 3).map((s) => (
                      <PressableScale key={s} onPress={() => setQ(s)} haptic="tap"
                        style={{
                          paddingHorizontal: 6, paddingVertical: 2,
                          backgroundColor: 'rgba(245,179,66,0.18)',
                          borderRadius: R.sm,
                        }}>
                        <Text style={{ fontSize: 10, color: '#F5B342' }}>{s}</Text>
                      </PressableScale>
                    ))}
                  </View>
                )}
              </View>
            )}

            {/*
              Google 風セグメント結果:
                - 'all' タブ → 投稿 / コミュニティ(タグ) / タグ / ユーザー の順、各 max 3 + 「もっと見る」
                - その他のタブ → そのカテゴリだけ全件表示
              現状の rankedPosts / rankedTags / bbsQ.data はそれぞれ後段で
              スライスして「preview limit」を適用する。
            */}

            {/* 投稿結果 */}
            {showPosts && rankedPosts.length > 0 && (
              <SectionContainer
                title="投稿"
                icon="📝"
                total={rankedPosts.length}
                expanded={expandedPosts}
                limit={category === 'all' ? PREVIEW_LIMIT : rankedPosts.length}
                onExpand={() => {
                  setCategory('posts');
                  setExpandedPosts(true);
                }}
              >
                {(category === 'all' && !expandedPosts
                  ? rankedPosts.slice(0, PREVIEW_LIMIT)
                  : rankedPosts
                ).map(({ item: p, reasons }) => (
                  <PressableScale
                    key={p.id}
                    onPress={() => {
                      commit();
                      recordSignal({ kind: 'post', id: p.id, tags: p.tag_names });
                      router.push(`/post/${p.id}` as never);
                    }}
                    haptic="tap"
                    style={{
                      padding: SP['3'],
                      backgroundColor: C.bg2,
                      borderRadius: R.lg,
                      borderWidth: 1, borderColor: C.border,
                      gap: SP['2'],
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'], flexWrap: 'wrap' }}>
                      <Avatar size={20} anonymous />
                      <Text style={[T.caption, { color: C.text3, flex: 1 }]}>
                        匿名 · {formatRelative(p.created_at)} · ♥{p.likes_count} 💬{p.comments_count}
                      </Text>
                    </View>
                    <HighlightedText
                      text={p.content}
                      terms={highlightTerms}
                      style={[T.body, { color: C.text }]}
                      numberOfLines={3}
                    />
                    {p.tag_names.length > 0 && (
                      <View style={{ flexDirection: 'row', gap: SP['1'], flexWrap: 'wrap' }}>
                        {Array.from(new Set(p.tag_names)).map((tg) => (
                          <Text key={tg} style={[T.caption, { color: highlightTerms.some((h) => normalize(tg).includes(normalize(h))) ? C.accentLight : C.accent, fontWeight: highlightTerms.some((h) => normalize(tg).includes(normalize(h))) ? '700' : '400' }]}>
                            #{tg}
                          </Text>
                        ))}
                      </View>
                    )}
                    <ReasonBadges reasons={reasons} />
                  </PressableScale>
                ))}
              </SectionContainer>
            )}

            {/* 掲示板スレッド */}
            {showBBS && (bbsQ.data?.length ?? 0) > 0 && (
              <SectionContainer
                title="掲示板"
                icon="💬"
                total={bbsQ.data!.length}
                expanded={expandedBBS}
                limit={category === 'all' ? PREVIEW_LIMIT : bbsQ.data!.length}
                onExpand={() => {
                  setCategory('bbs');
                  setExpandedBBS(true);
                }}
              >
                {(category === 'all' && !expandedBBS
                  ? bbsQ.data!.slice(0, PREVIEW_LIMIT)
                  : bbsQ.data!.slice(0, 12)
                ).map((t) => (
                  <PressableScale
                    key={t.id}
                    onPress={() => {
                      commit();
                      recordSignal({ kind: 'bbs', id: t.id, tags: [t.category] });
                      router.push(`/bbs/${t.id}` as never);
                    }}
                    haptic="tap"
                    style={{
                      padding: SP['3'],
                      backgroundColor: C.bg2,
                      borderRadius: R.lg,
                      borderWidth: 1, borderColor: C.border,
                      gap: 4,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
                      <Text style={{ fontSize: 14 }}>💬</Text>
                      <View style={{ flex: 1 }}>
                        <HighlightedText text={t.title} terms={highlightTerms} style={T.bodyMd} numberOfLines={1} />
                      </View>
                    </View>
                    <Text style={[T.caption, { color: C.text3 }]}>
                      {t.category} · {t.replies_count.toLocaleString('ja-JP')} 返信 · {formatRelative(t.created_at)}
                    </Text>
                  </PressableScale>
                ))}
              </SectionContainer>
            )}

            {/* タグ結果 */}
            {showTags && rankedTags.length > 0 && (
              <SectionContainer
                title="タグ"
                icon="#️⃣"
                total={rankedTags.length}
                expanded={expandedTags}
                limit={category === 'all' ? PREVIEW_LIMIT : rankedTags.length}
                onExpand={() => {
                  setCategory('tags');
                  setExpandedTags(true);
                }}
              >
                {(category === 'all' && !expandedTags
                  ? rankedTags.slice(0, PREVIEW_LIMIT)
                  : rankedTags
                ).map(({ item: tg, reasons }) => (
                  <PressableScale
                    key={tg.name}
                    onPress={() => {
                      commit();
                      recordSignal({ kind: 'tag', id: tg.name, tags: [tg.name] });
                      router.push(`/tag/${encodeURIComponent(tg.name)}` as never);
                    }}
                    haptic="tap"
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: SP['3'],
                      padding: SP['3'],
                      backgroundColor: C.bg2,
                      borderRadius: R.lg,
                      borderWidth: 1, borderColor: C.border,
                    }}
                  >
                    <View style={{
                      width: 40, height: 40, borderRadius: 20,
                      backgroundColor: C.accentSoft,
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Text style={{ fontSize: 18, color: C.accent, fontWeight: '700' }}>#</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <HighlightedText text={`#${tg.name}`} terms={highlightTerms} style={T.bodyMd} />
                      <Text style={[T.caption, { color: C.text3 }]}>
                        {tg.member_count.toLocaleString('ja-JP')} メンバー · {tg.post_count.toLocaleString('ja-JP')} 投稿
                      </Text>
                    </View>
                    <ReasonBadges reasons={reasons} />
                  </PressableScale>
                ))}
              </SectionContainer>
            )}

            {totalResults === 0 && !suggestion && (
              <View style={{ padding: SP['8'], alignItems: 'center', gap: SP['4'] }}>
                <View style={{
                  width: 96, height: 96, borderRadius: 48,
                  backgroundColor: C.amberBg, alignItems: 'center', justifyContent: 'center',
                  borderWidth: 1, borderColor: C.amber + '40',
                }}>
                  <Icon.search size={40} color={C.amber} strokeWidth={2} />
                </View>
                <Text style={[T.h4, { color: C.text, textAlign: 'center' }]}>
                  「{debounced}」に一致する結果はありません
                </Text>
                <Text style={[T.small, { color: C.text3, textAlign: 'center', maxWidth: 280 }]}>
                  別のキーワードで試すか、人気のタグから探してみよう
                </Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ============================================================
// SectionContainer — Google 風セグメント結果セクションのフレーム
// ------------------------------------------------------------
// title + icon + 件数 + 子コンポーネント を共通レイアウトで描画する。
// preview mode (limit < total) では「もっと見る」ボタンを下に出す。
// ============================================================
function SectionContainer({
  title,
  icon,
  total,
  limit,
  expanded,
  onExpand,
  children,
}: {
  title: string;
  icon: string;
  total: number;
  limit: number;
  expanded: boolean;
  onExpand: () => void;
  children: React.ReactNode;
}) {
  const showMore = !expanded && total > limit;
  return (
    <View style={{ gap: SP['2'] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontSize: 14 }}>{icon}</Text>
          <Text style={[T.smallM, { color: C.text2, fontWeight: '700', letterSpacing: 0.3 }]}>
            {title}
          </Text>
          <View style={{
            paddingHorizontal: 6, paddingVertical: 1,
            backgroundColor: C.bg3,
            borderRadius: R.sm,
          }}>
            <Text style={{ fontSize: 10, color: C.text3, fontWeight: '700' }}>
              {total}
            </Text>
          </View>
        </View>
      </View>
      {children}
      {showMore && (
        <PressableScale
          onPress={onExpand}
          haptic="tap"
          accessibilityRole="button"
          accessibilityLabel={`${title}をもっと見る`}
          style={{
            marginTop: SP['1'],
            paddingVertical: SP['2'] + 2,
            paddingHorizontal: SP['3'],
            backgroundColor: C.bg2,
            borderRadius: R.full,
            borderWidth: 1,
            borderColor: C.accent + '40',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
          }}
        >
          <Text style={[T.smallM, { color: C.accentLight, fontWeight: '700' }]}>
            {title}をもっと見る ({total - limit})
          </Text>
          <Icon.chevronR size={14} color={C.accentLight} strokeWidth={2.2} />
        </PressableScale>
      )}
    </View>
  );
}
