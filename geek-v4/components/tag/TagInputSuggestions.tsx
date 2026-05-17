import { useMemo, useEffect } from 'react';
import { View, Text } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { PressableScale } from '@/components/ui/PressableScale';
import { useTagGraphStore } from '@/stores/tagGraphStore';
import { useTagCooccurStore } from '@/stores/tagCooccurStore';
import { generateVariants } from '@/lib/search/variants';
import { normalize } from '@/lib/search/tokenize';
import { findRelatedTags, tagSimilarity } from '@/lib/search/tagVector';
import { findClosestK } from '@/lib/search/typoCorrect';
import { C, R, SP } from '@/design/tokens';
import { T } from '@/design/typography';

async function fetchAllTagNames(): Promise<string[]> {
  const { data } = await supabase
    .from('tags')
    .select('name')
    .order('member_count', { ascending: false })
    .limit(500);
  return (data ?? []).map((t: { name: string }) => t.name);
}

/**
 * 入力中のテキストから類似タグを提案するコンポーネント。
 * - 表記ゆれ (=LOVE → イコラブ)
 * - 字面類似 + 部分一致
 * - 共起マトリクスからの関連
 * - タグツリーの別名/関連
 * 全てを組み合わせて上位 N 件を提案
 */
export function TagInputSuggestions({
  input,
  excludeTags = [],
  onPick,
  variant = 'liked',
  limit = 10,
}: {
  input: string;
  excludeTags?: string[];
  onPick: (tag: string) => void;
  variant?: 'liked' | 'blocked';
  limit?: number;
}) {
  const { nodes, hydrate: hydrateGraph } = useTagGraphStore();
  const { cooccur, tagPopularity, hydrate: hydrateCooccur, ensureFresh } = useTagCooccurStore();

  useEffect(() => {
    void hydrateGraph();
    void hydrateCooccur();
    void ensureFresh();
  }, [hydrateGraph, hydrateCooccur, ensureFresh]);

  const allTagsQ = useQuery({
    queryKey: ['all-tag-names'],
    queryFn: fetchAllTagNames,
    staleTime: 5 * 60_000,
  });

  const excludeSet = useMemo(() => new Set(excludeTags.map(normalize)), [excludeTags]);

  const suggestions = useMemo(() => {
    const trimmed = input.trim().replace(/^#/, '');
    if (trimmed.length < 1) return [];

    const allTags = allTagsQ.data ?? [];
    const variants = generateVariants(trimmed);
    const variantSet = new Set(variants.map(normalize));
    const qn = normalize(trimmed);

    // タグ候補プール: API のタグ + graph 内のラベル/別名/関連 + 共起マップから
    const candidatePool = new Set<string>();
    for (const t of allTags) candidatePool.add(t);
    for (const n of Object.values(nodes)) {
      candidatePool.add(n.label);
      for (const a of n.aliases) candidatePool.add(a);
      for (const r of n.related ?? []) candidatePool.add(r);
    }
    for (const t of Object.keys(tagPopularity)) candidatePool.add(t);

    type Scored = { tag: string; score: number; reason: string };
    const scored: Scored[] = [];
    const seen = new Set<string>();

    for (const tag of candidatePool) {
      const tn = normalize(tag);
      if (excludeSet.has(tn) || seen.has(tn)) continue;
      seen.add(tn);

      let score = 0;
      let reason = '';

      // 1. 完全一致
      if (tn === qn) { score = 1000; reason = '完全一致'; }
      // 2. variant マッチ (=LOVE → イコラブ)
      else if (variantSet.has(tn)) { score = 800; reason = '同義語'; }
      // 3. 前方一致
      else if (tn.startsWith(qn)) { score = 500 + (50 - Math.min(50, tn.length)); reason = '前方一致'; }
      // 4. 部分一致
      else if (tn.includes(qn)) { score = 300 + (50 - Math.min(50, tn.length)); reason = '部分一致'; }
      // 5. variants の部分一致
      else if (variants.some((v) => tn.includes(normalize(v)))) { score = 200; reason = '表記ゆれ'; }
      else {
        // 6. ベクトル類似度 (字面 + 共起 + グラフ)
        const sim = tagSimilarity(trimmed, tag, { nodes, cooccur });
        if (sim.score >= 0.3) {
          score = 100 + sim.score * 200;
          reason = sim.signals[0] ?? '関連';
        }
      }
      // 人気度 (微加点)
      const pop = tagPopularity[tag] ?? 0;
      if (pop > 0) score += Math.log(1 + pop) * 0.5;

      if (score > 0) scored.push({ tag, score, reason });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }, [input, allTagsQ.data, nodes, cooccur, tagPopularity, excludeSet, limit]);

  if (suggestions.length === 0 || input.trim().length < 1) return null;

  const colorFor = variant === 'blocked' ? '#FF6B7A' : C.accent;
  const bgFor    = variant === 'blocked' ? 'rgba(255,107,122,0.13)' : C.accentBg;
  const borderFor= variant === 'blocked' ? 'rgba(255,107,122,0.4)' : C.accentSoft;

  return (
    <View style={{
      padding: SP['2'],
      backgroundColor: C.bg2,
      borderRadius: R.md,
      borderWidth: 1,
      borderColor: C.border,
      gap: SP['1'],
    }}>
      <Text style={[T.caption, { color: C.text3, paddingHorizontal: 4 }]}>
        💡 候補
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {suggestions.map((s) => (
          <PressableScale
            key={s.tag}
            onPress={() => onPick(s.tag)}
            haptic="confirm"
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 4,
              paddingHorizontal: SP['3'], paddingVertical: 6,
              backgroundColor: bgFor,
              borderRadius: R.full,
              borderWidth: 1, borderColor: borderFor,
            }}
          >
            <Text style={{ fontSize: 11, color: colorFor }}>＋</Text>
            <Text style={[T.smallM, { color: colorFor, fontWeight: '700' }]}>
              #{s.tag}
            </Text>
            <Text style={{ fontSize: 9, color: C.text3, marginLeft: 2 }}>
              {s.reason}
            </Text>
          </PressableScale>
        ))}
      </View>
    </View>
  );
}
