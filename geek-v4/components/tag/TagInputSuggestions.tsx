import { useMemo, useEffect } from 'react';
import { View, Text } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { PressableScale } from '@/components/ui/PressableScale';
import { useTagGraphStore } from '@/stores/tagGraphStore';
import { useTagCooccurStore } from '@/stores/tagCooccurStore';
import { useTagFilterStore } from '@/stores/tagFilterStore';
import { useSearchSignalsStore } from '@/stores/searchSignalsStore';
import { searchTags, didYouMean } from '@/lib/search/tagSearchV2';
import { normalize } from '@/lib/search/tokenize';
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
 * 入力中のテキストから類似タグを提案するコンポーネント (V2 エンジン)
 * - 8シグナル統合スコアリング (完全一致 / 同義語 / アクロニム / 前方/部分 / タイポ / ベクトル / マルチトークン)
 * - 個人化ブースト (likedTags 近接 / 共起活動 / 過去クリック頻度)
 * - ダイバーシフィケーション (類似タグの cluster suppression)
 * - Did you mean? (タイポ時に補正候補を1件提示)
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
  const { likedTags, blockedTags } = useTagFilterStore();
  const aggregate = useSearchSignalsStore((s) => s.aggregate);

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

  const signals = useMemo(() => aggregate(), [aggregate]);

  // 既存除外 (likedTags + blockedTags + 渡された excludeTags)
  const fullExclude = useMemo(
    () => [...excludeTags, ...likedTags, ...blockedTags],
    [excludeTags, likedTags, blockedTags],
  );

  const { suggestions, dymResult } = useMemo(() => {
    const trimmed = input.trim().replace(/^#/, '');
    if (trimmed.length < 1) return { suggestions: [], dymResult: null };

    const ctx = {
      allTags: allTagsQ.data ?? [],
      nodes,
      cooccur,
      tagPopularity,
      likedTags,
      blockedTags: fullExclude,
      tagAffinity: signals.tagFreq,
    };
    const results = searchTags(trimmed, ctx, { limit, diversify: true });
    const dym = results.length === 0 ? didYouMean(trimmed, ctx) : null;
    return { suggestions: results, dymResult: dym };
  }, [input, allTagsQ.data, nodes, cooccur, tagPopularity, fullExclude, likedTags, blockedTags, signals.tagFreq, limit]);

  if (input.trim().length < 1) return null;
  if (suggestions.length === 0 && !dymResult) return null;

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
      {/* Did you mean? */}
      {dymResult && suggestions.length === 0 && (
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 6,
          paddingHorizontal: 6, paddingVertical: 4,
        }}>
          <Text style={[T.caption, { color: C.text3 }]}>もしかして:</Text>
          <PressableScale
            onPress={() => onPick(dymResult.tag)}
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
              #{dymResult.tag}
            </Text>
          </PressableScale>
        </View>
      )}

      {/* Suggestion chips */}
      {suggestions.length > 0 && (
        <>
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
                  {s.primaryReason}
                </Text>
              </PressableScale>
            ))}
          </View>
        </>
      )}
    </View>
  );
}
