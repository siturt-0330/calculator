import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, type LayoutChangeEvent } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { fetchTrendingTags, type TrendingTag } from '../../lib/api/trending';
import { useTagCooccurStore } from '../../stores/tagCooccurStore';
import { PressableScale } from '../ui/PressableScale';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';

// data 未取得時の default。module 定数にして「毎レンダー新しい [] 参照」を作らない。
// 旧 `data: trending = []` は loading 中に新しい [] を量産し、useEffect([trending]) を
// 毎レンダー無限発火させて "Maximum update depth exceeded" を起こしていた。
const EMPTY_TRENDING: TrendingTag[] = [];

function TrendingRowInner() {
  const router = useRouter();

  // 各 chip の開始 x 座標を ref に積み、揃ったら snapToOffsets に渡す。
  // これでスクロール停止位置が必ず「ある chip の左端」になり、半分見切れの
  // 中途半端な状態がなくなる (画面に入っているなら完全表示、外なら完全に隠れる)。
  const positionsRef = useRef<Map<string, number>>(new Map());
  const [snapOffsets, setSnapOffsets] = useState<number[]>([]);

  // Phase 3: cluster diversity を有効にするため cooccur を取得 (hydrate 済みなら)
  // cooccur が無くても fetch 自体は動く (diversify はスキップ)
  const cooccur = useTagCooccurStore((s) => s.cooccur);
  const cooccurHydrated = useTagCooccurStore((s) => s.hydrated);
  const cooccurHasData = cooccurHydrated && Object.keys(cooccur).length > 0;
  const cooccurKey = cooccurHasData ? 'div' : 'plain';

  // Audit E#5 (2026-05-28): 旧版は `trending-tags-refresh` channel で
  // `posts INSERT` (filter 不可) を購読していたが、トレンドは 5 分粒度の集計で
  // 十分鮮度を保てる + INSERT 全件 fanout は全クライアントに刺さって痛い。
  // staleTime 5 分 + pull-to-refresh / feed refetch で十分なので realtime 撤去。
  const { data } = useQuery({
    queryKey: ['trending-tags', cooccurKey],
    queryFn: () => fetchTrendingTags({
      limit: 10,
      // diversify は cooccur が hydrate されている場合のみ — 1 cluster 1 代表
      ...(cooccurHasData ? { diversify: true, cooccur } : {}),
    }),
    staleTime: 5 * 60 * 1000,  // 5分
    refetchOnMount: false,
  });
  // 安定した空配列を default にする (上記 EMPTY_TRENDING のコメント参照)。
  const trending = data ?? EMPTY_TRENDING;

  // trending が変わったら計測をリセット
  useEffect(() => {
    positionsRef.current.clear();
    // 既に空なら新しい [] を作らない (無駄な再レンダー/churn を避ける)。
    setSnapOffsets((prev) => (prev.length === 0 ? prev : []));
  }, [trending]);

  const handleChipLayout = useCallback(
    (name: string, e: LayoutChangeEvent) => {
      positionsRef.current.set(name, e.nativeEvent.layout.x);
      // すべての chip が onLayout 通過したら offsets を sorted array で確定
      if (positionsRef.current.size === trending.length) {
        const offsets = [...positionsRef.current.values()].sort((a, b) => a - b);
        // 同値なら据え置き — onLayout 再発火 → 新配列 setState の再レンダーループを防ぐ。
        setSnapOffsets((prev) =>
          prev.length === offsets.length && prev.every((v, i) => v === offsets[i]) ? prev : offsets,
        );
      }
    },
    [trending.length],
  );

  if (trending.length === 0) return null;

  return (
    <Animated.View
      entering={FadeIn.duration(300).delay(80)}
      style={{ alignItems: 'center', backgroundColor: C.bg }}
    >
      <View style={{ width: '100%', maxWidth: 720, paddingHorizontal: SP['4'], paddingTop: SP['2'], paddingBottom: SP['3'] }}>
        <Text style={[T.caption, { color: C.text3, letterSpacing: 0.5, marginBottom: SP['2'] }]}>
          トレンド
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: SP['2'], paddingRight: SP['4'] }}
          // 各 chip の開始位置で snap させ、半分見切れの中途半端な状態を防ぐ。
          // 画面外にスクロールアウトしたものは完全に見切れる挙動になる。
          snapToOffsets={snapOffsets.length > 0 ? snapOffsets : undefined}
          snapToAlignment="start"
          decelerationRate="fast"
        >
          {trending.map((t, i) => (
            <PressableScale
              key={t.name}
              onPress={() => router.push(`/tag/${encodeURIComponent(t.name)}` as never)}
              haptic="tap"
              onLayout={(e) => handleChipLayout(t.name, e)}
              style={{
                paddingHorizontal: SP['3'],
                paddingVertical: SP['2'],
                backgroundColor: i === 0 ? C.accentBg : C.bg2,
                borderRadius: R.full,
                borderWidth: 1,
                borderColor: i === 0 ? C.accent : C.border,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {i === 0 && <Text style={{ fontSize: 11 }}>👑</Text>}
              <Text style={[T.smallM, { color: i === 0 ? C.accent : C.text, fontWeight: '700' }]}>
                #{t.name}
              </Text>
              <View style={{
                paddingHorizontal: 6, paddingVertical: 1,
                backgroundColor: i === 0 ? C.accentSoft : C.bg3,
                borderRadius: R.sm,
              }}>
                <Text style={{ fontSize: 10, color: i === 0 ? C.accent : C.text3, fontWeight: '700' }}>
                  +{t.postCount}
                </Text>
              </View>
            </PressableScale>
          ))}
        </ScrollView>
      </View>
    </Animated.View>
  );
}

export const TrendingRow = memo(TrendingRowInner);
