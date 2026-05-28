// ============================================================
// TrendingTopics — Discovery タブの「トレンドトピック」横スクロール
// ------------------------------------------------------------
// iOS-native pill chip row。各 chip は `#トピック · NNN posts` を表示。
// - tap → 該当キーワードで検索 (onTopicPress prop)
// - データ source: C2 が hooks/useSearchV2.ts に `useTrendingTopics` を
//   作成中。本コンポーネントは hook が無くてもビルドが通るように
//   `fetchTrendingTags` を直接 useQuery で叩く fallback 実装にしている。
//   (props で `topics` を渡せば外部 hook のデータをそのまま流せる)
// - skeleton loading state (4 chip 分の灰色 placeholder)
// - dark mode: useColors() で theme tokens に追従
// ============================================================
import { useMemo } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useColors } from '../../hooks/useColors';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';
import { R, SP, SHADOW } from '../../design/tokens';
import { T } from '../../design/typography';
import { fetchTrendingTags } from '../../lib/api/trending';

// ============================================================
// public types
// ============================================================
export type TrendingTopic = {
  /** タグ名 (先頭の # は含まない) */
  name: string;
  /** 該当 window 内の投稿件数。0 や undefined のときは件数 chip を出さない */
  postCount?: number;
};

export interface TrendingTopicsProps {
  /** tap callback。引数はタグ名 (# 抜き) */
  onTopicPress: (topic: string) => void;
  /** 外部から topics を渡す場合 (= C2 の useTrendingTopics が完成したら) */
  topics?: ReadonlyArray<TrendingTopic>;
  /** 外部 hook 由来の loading state を伝えたいとき */
  loading?: boolean;
  /** 最大表示件数 (default 10) */
  limit?: number;
}

// ============================================================
// 内部: fallback fetch
// ------------------------------------------------------------
// props.topics が省略された時のみ走る。C2 が useTrendingTopics を提供したら
// 呼び出し側でそちらを使い、本コンポーネントは presentational のままで済む。
// ============================================================
function useFallbackTrending(enabled: boolean, limit: number) {
  return useQuery({
    queryKey: ['trending-topics-fallback', limit],
    queryFn: () => fetchTrendingTags({ window: '24h', limit }),
    staleTime: 5 * 60_000,
    enabled,
  });
}

// ============================================================
// main
// ============================================================
export function TrendingTopics({
  onTopicPress,
  topics,
  loading,
  limit = 10,
}: TrendingTopicsProps) {
  const C = useColors();
  // props.topics が undefined の時のみ fallback fetch
  const fallback = useFallbackTrending(topics === undefined, limit);

  const items = useMemo<ReadonlyArray<TrendingTopic>>(() => {
    if (topics !== undefined) return topics.slice(0, limit);
    return (fallback.data ?? []).slice(0, limit).map((t) => ({
      name: t.name,
      postCount: t.postCount,
    }));
  }, [topics, fallback.data, limit]);

  const isLoading = loading ?? (topics === undefined && fallback.isLoading);

  // skeleton: 初期 loading で何も無い時のみ chip 4 個分のグレー placeholder を出す
  if (isLoading && items.length === 0) {
    return (
      <View style={{ gap: SP['2'] }}>
        <Header C={C} />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            gap: SP['2'],
            paddingHorizontal: SP['4'],
            paddingVertical: 2,
          }}
        >
          {[0, 1, 2, 3].map((i) => (
            <View
              key={`sk-${i}`}
              style={{
                width: 120 + (i % 2) * 24,
                height: 36,
                borderRadius: R.full,
                backgroundColor: C.bg2,
                borderWidth: 1,
                borderColor: C.border,
                opacity: 0.6,
              }}
            />
          ))}
        </ScrollView>
      </View>
    );
  }

  // empty: 何も出ない時は section ごと描画しない (親 ScrollView の空白を減らす)
  if (items.length === 0) return null;

  return (
    <View style={{ gap: SP['2'] }}>
      <Header C={C} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          gap: SP['2'],
          paddingHorizontal: SP['4'],
          paddingVertical: 2,
        }}
        accessibilityRole="list"
      >
        {items.map((t, i) => (
          <TopicChip
            key={`trend-${t.name}`}
            topic={t}
            rank={i}
            onPress={() => onTopicPress(t.name)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

// ============================================================
// Header — iOS の List section header に近いトーン (小さめ + tracking)
// ============================================================
function Header({ C }: { C: ReturnType<typeof useColors> }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: SP['4'],
      }}
    >
      <Icon.sparkles size={14} color={C.text3} strokeWidth={2.2} />
      <Text style={[T.smallM, { color: C.text3, letterSpacing: 0.5 }]}>
        トレンド
      </Text>
    </View>
  );
}

// ============================================================
// TopChip — iOS-native pill (radius full, padding 12/16, subtle shadow)
// - rank 0 (1 位) はアクセントカラーで強調 (TrendingRow の踏襲)
// ============================================================
function TopicChip({
  topic,
  rank,
  onPress,
}: {
  topic: TrendingTopic;
  rank: number;
  onPress: () => void;
}) {
  const C = useColors();
  const isTop = rank === 0;
  const count = topic.postCount ?? 0;

  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      scaleValue={0.96}
      accessibilityLabel={`${topic.name} で検索`}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          // iOS-native: 縦 padding は 12pt 弱 (chip height ≈ 36pt)、横は 16
          paddingHorizontal: SP['4'],
          paddingVertical: SP['2'] + 2,
          borderRadius: R.full,
          backgroundColor: isTop ? C.accentBg : C.bg2,
          borderWidth: 1,
          borderColor: isTop ? C.accent : C.border,
        },
        SHADOW.xs,
      ]}
    >
      <Icon.hash
        size={12}
        color={isTop ? C.accent : C.text3}
        strokeWidth={2.4}
      />
      <Text
        style={[
          T.smallB,
          {
            color: isTop ? C.accent : C.text,
            // SF Pro semibold 風: letterSpacing をわずかにきつめに
            letterSpacing: -0.1,
          },
        ]}
        numberOfLines={1}
      >
        {topic.name}
      </Text>
      {count > 0 ? (
        <>
          <Text
            style={[
              T.caption,
              { color: isTop ? C.accent : C.text3, opacity: 0.6 },
            ]}
          >
            ·
          </Text>
          <Text
            style={[
              T.caption,
              {
                color: isTop ? C.accent : C.text3,
                fontWeight: '700',
              },
            ]}
          >
            {count.toLocaleString('ja-JP')} posts
          </Text>
        </>
      ) : null}
    </PressableScale>
  );
}
