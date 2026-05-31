import { useMemo } from 'react';
import { View, Text } from 'react-native';
import Animated, { FadeInDown, Layout } from 'react-native-reanimated';
import { PressableScale } from '../ui/PressableScale';
import { useTagSearchV3 } from '../../hooks/useTagSearchV3';
import { useSearchClickStore } from '../../stores/searchClickStore';
import { classifyIntent, intentEmoji, intentLabel } from '../../lib/search/queryIntent';
import { didYouMean } from '../../lib/search/tagSearchV2';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';

/**
 * Tag 入力中の高度な候補サジェスト (Search V3 を利用):
 * - N-gram inverted index で高速 recall
 * - PMI cosine 意味類似度
 * - 複合語自動分割 ("ポケモンアニメ" → ポケモン + アニメ)
 * - 適応的スコアリング (クエリ長で重み変化)
 * - トレンドブースト
 * - ハイライト (マッチ部分を bold で示す)
 * - もしかして (ゼロ件時)
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
  const { ctx, search } = useTagSearchV3();
  const recordClick = useSearchClickStore((s) => s.record);

  // 既存除外を context に合体
  const ctxWithExclude = useMemo(() => ({
    ...ctx,
    blockedTags: [...(ctx.blockedTags ?? []), ...excludeTags],
  }), [ctx, excludeTags]);

  const trimmed = input.trim().replace(/^#/, '');
  // ★ try/catch ガード (2026-05-31): タグ入力中に検索エンジン (variants /
  //   ngram / PMI / didYouMean) のいずれかが例外を投げると画面ごと crash していた
  //   問題の防御。失敗時は空サジェストにフォールバックし入力フローを止めない。
  const suggestions = useMemo(() => {
    if (trimmed.length < 1) return [];
    try {
      return search(trimmed, limit);
    } catch (e) {
      console.warn('[TagInputSuggestions] search threw:', e);
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmed, limit, ctx.tagPopularity, ctx.cooccur, ctx.nodes, ctx.likedTags, ctx.blockedTags]);

  // クエリ Intent (人名/作品/場所/年/質問/タグ)
  const intent = useMemo(() => {
    if (!trimmed) return null;
    try {
      return classifyIntent(trimmed);
    } catch (e) {
      console.warn('[TagInputSuggestions] classifyIntent threw:', e);
      return null;
    }
  }, [trimmed]);

  // CTR Boost wrap: クリック時に記録
  const pickWithLearning = (tag: string) => {
    try {
      recordClick(trimmed, tag);
    } catch (e) {
      console.warn('[TagInputSuggestions] recordClick threw:', e);
    }
    onPick(tag);
  };

  const dymResult = useMemo(() => {
    if (suggestions.length > 0 || trimmed.length < 2) return null;
    try {
      return didYouMean(trimmed, {
        allTags: ctxWithExclude.ngramIndex.getAllTags(),
        nodes: ctxWithExclude.nodes,
        cooccur: ctxWithExclude.cooccur,
        tagPopularity: ctxWithExclude.tagPopularity,
        likedTags: ctxWithExclude.likedTags,
        blockedTags: ctxWithExclude.blockedTags,
        tagAffinity: ctxWithExclude.tagAffinity,
      });
    } catch (e) {
      console.warn('[TagInputSuggestions] didYouMean threw:', e);
      return null;
    }
  }, [suggestions, trimmed, ctxWithExclude]);

  if (trimmed.length < 1) return null;
  if (suggestions.length === 0 && !dymResult) return null;

  const colorFor = variant === 'blocked' ? '#FF6B7A' : C.accent;
  const bgFor    = variant === 'blocked' ? 'rgba(255,107,122,0.13)' : C.accentBg;
  const borderFor= variant === 'blocked' ? 'rgba(255,107,122,0.4)' : C.accentSoft;

  return (
    <Animated.View
      entering={FadeInDown.duration(180)}
      layout={Layout.springify().damping(20)}
      style={{
      padding: SP['2'],
      backgroundColor: C.bg2,
      borderRadius: R.md,
      borderWidth: 1,
      borderColor: C.border,
      gap: SP['1'],
    }}>
      {/* もしかして */}
      {dymResult && suggestions.length === 0 && (
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 6,
          paddingHorizontal: 6, paddingVertical: 4,
        }}>
          <Text style={[T.caption, { color: C.text3 }]}>もしかして:</Text>
          <PressableScale
            onPress={() => pickWithLearning(dymResult.tag)}
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

      {/* Intent Badge */}
      {intent && suggestions.length > 0 && (
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 4,
          paddingHorizontal: 4,
        }}>
          <Text style={{ fontSize: 11 }}>{intentEmoji(intent)}</Text>
          <Text style={[T.caption, { color: C.text3 }]}>
            意図: {intentLabel(intent)}
          </Text>
        </View>
      )}

      {suggestions.length > 0 && (
        <>
          <Text style={[T.caption, { color: C.text3, paddingHorizontal: 4 }]}>
            💡 候補
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {suggestions.map((s) => (
              <PressableScale
                key={s.tag}
                onPress={() => pickWithLearning(s.tag)}
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
                <Text style={{ fontSize: 13, color: colorFor, fontWeight: '700' }}>
                  #
                  {s.segments.length === 0 ? s.tag : s.segments.map((seg, i) => (
                    <Text key={i} style={{
                      color: colorFor,
                      fontWeight: seg.highlight ? '900' : '700',
                      textDecorationLine: seg.highlight ? 'underline' : 'none',
                    }}>
                      {seg.text}
                    </Text>
                  ))}
                </Text>
                <Text style={{ fontSize: 9, color: C.text3, marginLeft: 2 }}>
                  {s.primaryReason}
                </Text>
              </PressableScale>
            ))}
          </View>
        </>
      )}
    </Animated.View>
  );
}
