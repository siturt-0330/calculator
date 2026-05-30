// ============================================================
// EditorialSkeleton — EDITORIAL「特集」タブの組版中スケルトン
// ------------------------------------------------------------
// 実カードと同寸・同 padding の罫線スケルトンを描き、その上に
// 1 枚だけ水平シマー (LinearGradient の斜め帯) を流す。
// - レイアウトシフト 0: bar / サムネ / 円アバターは実カードと同サイズ
// - シマーは absolute fill の 1 枚に集約 (各 bar を個別に光らせない)
// - 帯は translateX を -120 → コンテナ幅+120 へ withRepeat で往復させる
// - コンテナ幅は onLayout で取得、未取得時は useWindowDimensions で fallback
// - useReducedMotion()===true なら帯を出さず静的 bar のみ (a11y)
// - spinner /「読み込み中」テキストは出さない (組版感を壊さないため)
// iOS / Android / Web 全対応・BlurView 不使用 (フラット=Web同一品質)。
// ============================================================
import { useEffect, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, GRAD, SP, R } from '../../design/tokens';
import { EASE_OUT } from '../../design/motion';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  useReducedMotion,
} from 'react-native-reanimated';

// ----- 寸法定数 (実カードと厳密に一致させる) -----
const THUMB = 88; // 記事サムネ 88x88
const AVATAR = 44; // コミュ円アバター 44
const SHIMMER_W = 120; // 斜め帯の幅
const SHIMMER_DURATION = 1100;

// 静的 bar — スケルトンの 1 本。高さ / 幅 / 余白を受け取る。
function Bar({
  height,
  width,
  marginTop,
}: {
  height: number;
  width: number | `${number}%`;
  marginTop?: number;
}) {
  return (
    <View
      style={{
        height,
        width,
        marginTop,
        borderRadius: R.sm,
        backgroundColor: C.bg2,
      }}
    />
  );
}

// 記事ブロック 1 枚: 上 hairline / paddingVertical SP[5] / 左 bar 群 + 右サムネ。
function ArticleRow() {
  return (
    <View
      style={{
        flexDirection: 'row',
        paddingVertical: SP['5'],
        borderTopWidth: 1,
        borderTopColor: C.divider,
      }}
    >
      {/* 左: title / 2 行目 / 抜粋 2 本 */}
      <View style={{ flex: 1, paddingRight: SP['4'] }}>
        <Bar height={22} width="70%" />
        <Bar height={14} width="90%" marginTop={SP['2']} />
        <Bar height={12} width="100%" marginTop={SP['2']} />
        <Bar height={12} width="60%" marginTop={SP['2']} />
      </View>
      {/* 右: サムネ 88x88 */}
      <View
        style={{
          width: THUMB,
          height: THUMB,
          borderRadius: R.md,
          backgroundColor: C.bg2,
        }}
      />
    </View>
  );
}

// コミュ行 1 本: 上 hairline / paddingVertical SP[4] / 円 44 + bar 2 本。
function CommunityRow() {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: SP['4'],
        borderTopWidth: 1,
        borderTopColor: C.divider,
      }}
    >
      {/* 円アバター 44 */}
      <View
        style={{
          width: AVATAR,
          height: AVATAR,
          borderRadius: R.full,
          backgroundColor: C.bg2,
        }}
      />
      {/* name / meta bar 2 本 */}
      <View style={{ flex: 1, marginLeft: SP['3'] }}>
        <Bar height={14} width="50%" />
        <Bar height={12} width="30%" marginTop={SP['2']} />
      </View>
    </View>
  );
}

export function EditorialSkeleton({
  posts = 3,
  communities = 2,
}: {
  posts?: number;
  communities?: number;
}) {
  const { width: screenWidth } = useWindowDimensions();
  const reduced = useReducedMotion();

  // コンテナ幅 — onLayout 取得前は画面幅を fallback に使う。
  const [containerWidth, setContainerWidth] = useState(0);
  const effectiveWidth = containerWidth > 0 ? containerWidth : screenWidth;

  // シマー進捗 0→1 を translateX(-120 → width+120) に写像。
  const progress = useSharedValue(0);

  useEffect(() => {
    if (reduced) {
      // reduce-motion: 帯を動かさない (静的 bar のみ)。
      progress.value = 0;
      return;
    }
    progress.value = 0;
    progress.value = withRepeat(
      withTiming(1, { duration: SHIMMER_DURATION, easing: EASE_OUT }),
      -1,
      false,
    );
  }, [reduced, progress]);

  const shimmerStyle = useAnimatedStyle(() => {
    const start = -SHIMMER_W;
    const end = effectiveWidth + SHIMMER_W;
    return {
      transform: [{ translateX: start + (end - start) * progress.value }],
    };
  });

  // 配列 index アクセスは noUncheckedIndexedAccess 下で T|undefined になるため
  // map ではなく明示的な長さ配列を Array.from で生成し index を key にする。
  const articleKeys = Array.from({ length: Math.max(0, posts) }, (_, i) => i);
  const communityKeys = Array.from(
    { length: Math.max(0, communities) },
    (_, i) => i,
  );

  return (
    <View
      style={{ paddingHorizontal: SP['4'], overflow: 'hidden' }}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        // 微小変化での再 render を避ける (1px 未満は無視)。
        setContainerWidth((prev) => (Math.abs(prev - w) > 1 ? w : prev));
      }}
      accessibilityRole="progressbar"
      accessibilityLabel="特集を組版中"
    >
      {/* 静的スケルトン本体 */}
      {articleKeys.map((i) => (
        <ArticleRow key={`art-${i}`} />
      ))}
      {communityKeys.map((i) => (
        <CommunityRow key={`com-${i}`} />
      ))}

      {/* 水平シマー — 全体を覆う 1 枚。reduce-motion 時は描画しない。 */}
      {!reduced ? (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              width: SHIMMER_W,
            },
            shimmerStyle,
          ]}
        >
          <LinearGradient
            colors={GRAD.glass}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ flex: 1, transform: [{ skewX: '-12deg' }] }}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}
