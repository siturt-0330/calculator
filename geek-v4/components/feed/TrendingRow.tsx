import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, type LayoutChangeEvent } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { fetchTrendingCommunities, type TrendingCommunity } from '../../lib/api/trending';
import { PressableScale } from '../ui/PressableScale';
import { CommunityIcon } from '../ui/CommunityIcon';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';

// data 未取得時の default。module 定数にして「毎レンダー新しい [] 参照」を作らない。
// (新しい [] を量産すると useEffect([trendCommunities]) が毎レンダー発火する)
const EMPTY_TRENDING: TrendingCommunity[] = [];

function TrendingRowInner() {
  const router = useRouter();

  // 各 chip の開始 x 座標を ref に積み、揃ったら snapToOffsets に渡す。
  // これでスクロール停止位置が必ず「ある chip の左端」になり、半分見切れの
  // 中途半端な状態がなくなる (画面に入っているなら完全表示、外なら完全に隠れる)。
  const positionsRef = useRef<Map<string, number>>(new Map());
  const [snapOffsets, setSnapOffsets] = useState<number[]>([]);

  // ★ 2026-06-13: 「タグ → コミュ名一致」の間接解決を廃止し、post_communities の
  //   直近 48h (薄ければ 7 日) を直接集計する fetchTrendingCommunities へ。
  //   旧方式はトレンドタグ名がコミュ名と偶然一致した時しかコミュが出ず、
  //   コミュ内の実際の投稿活動を全く反映していなかった (ユーザー報告)。
  //   postCount は「その window に投稿された実数」になった。
  const { data } = useQuery({
    queryKey: ['trending-communities'],
    queryFn: () => fetchTrendingCommunities(8),
    staleTime: 5 * 60 * 1000,  // 5分
    refetchOnMount: false,
  });
  const trendCommunities = data ?? EMPTY_TRENDING;

  // chip 構成が変わったら計測をリセット
  useEffect(() => {
    positionsRef.current.clear();
    // 既に空なら新しい [] を作らない (無駄な再レンダー/churn を避ける)。
    setSnapOffsets((prev) => (prev.length === 0 ? prev : []));
  }, [trendCommunities]);

  const handleChipLayout = useCallback(
    (key: string, e: LayoutChangeEvent) => {
      positionsRef.current.set(key, e.nativeEvent.layout.x);
      // すべての chip が onLayout 通過したら offsets を sorted array で確定
      if (positionsRef.current.size === trendCommunities.length) {
        const offsets = [...positionsRef.current.values()].sort((a, b) => a - b);
        // 同値なら据え置き — onLayout 再発火 → 新配列 setState の再レンダーループを防ぐ。
        setSnapOffsets((prev) =>
          prev.length === offsets.length && prev.every((v, i) => v === offsets[i]) ? prev : offsets,
        );
      }
    },
    [trendCommunities.length],
  );

  if (trendCommunities.length === 0) return null;

  return (
    <Animated.View
      entering={FadeIn.duration(300).delay(80)}
      style={{ alignItems: 'center', backgroundColor: C.bg }}
    >
      <View style={{ width: '100%', maxWidth: 720, paddingHorizontal: SP['4'], paddingTop: SP['2'], paddingBottom: SP['3'] }}>
        <Text style={[T.caption, { color: C.text3, letterSpacing: 0.5, marginBottom: SP['2'] }]}>
          盛り上がってるコミュニティ
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
          {trendCommunities.map(({ community: c, postCount }, i) => (
            <PressableScale
              key={c.id}
              onPress={() => router.push(`/community/${c.id}` as never)}
              haptic="tap"
              onLayout={(e) => handleChipLayout(c.id, e)}
              accessibilityLabel={
                i === 0
                  ? `注目のコミュニティ ${c.name} を開く (直近 ${postCount} 件)`
                  : `コミュニティ ${c.name} を開く (直近 ${postCount} 件)`
              }
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
              {/* ★ 2026-06-13: emoji だけ (icon_emoji ?? '👥') では画像アイコン
                  (icon_url) のコミュが汎用 👥 になっていた。共有 CommunityIcon に
                  統一し icon_url(画像) → emoji → 頭文字 の優先で必ず実アイコンを出す。 */}
              <CommunityIcon
                size={20}
                iconUrl={c.icon_url}
                iconEmoji={c.icon_emoji}
                iconColor={c.icon_color}
                name={c.name}
              />
              <Text style={[T.smallM, { color: i === 0 ? C.accent : C.text, fontWeight: '700' }]}>
                {c.name}
              </Text>
              <View style={{
                paddingHorizontal: 6, paddingVertical: 1,
                backgroundColor: i === 0 ? C.accentSoft : C.bg3,
                borderRadius: R.sm,
              }}>
                <Text style={{ fontSize: 11, color: i === 0 ? C.accent : C.text3, fontWeight: '700' }}>
                  +{postCount}
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
