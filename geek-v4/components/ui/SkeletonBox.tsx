// ============================================================
// SkeletonBox — shimmer animation primitive
// ------------------------------------------------------------
// 体感目的:
//   ただの灰色 plate ではなく、左→右に hi-light band が滑る shimmer で
//   「読み込み中」の静的待機を「もうすぐ来る」期待感に変える。
//
// 設計:
//   - LinearGradient (透明 → 白 8% → 透明) を Animated.View で translateX
//   - 周期 1.4s / Easing は左右等速感のある cubic (visual に linear に近いが
//     端で急停止しないよう ease-in-out 系)
//   - useSharedValue + withRepeat。worklet safe
//   - measured width が分かるまでは 200px の仮値で開始 → onLayout で更新
//   - dark / light テーマ対応: base は useColors().bg3、band の高輝度色を
//     light テーマでは黒 alpha に切替 (白 base に白 band では見えない)
//   - React.memo + 浅い props 比較で同一 props なら再 render を抑止
// ============================================================
import React, { useEffect, useState, useMemo } from 'react';
import { View, DimensionValue, ViewStyle, LayoutChangeEvent } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  interpolate,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useColors } from '../../hooks/useColors';
import { useTheme } from '../../hooks/useColors';
import { R } from '../../design/tokens';

// shimmer band の幅 (固定。container の幅に対する translateX を計算する)
const SHIMMER_BAND_WIDTH = 110;
// 1 周期。1.4s が「気持ちいい」体感の sweet spot
const SHIMMER_DURATION_MS = 1400;
// container 幅が未確定のときの仮値 (最初の 1 frame だけ使われる)
const FALLBACK_W = 200;

export interface SkeletonBoxProps {
  width?: DimensionValue;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

// 共有 progress を 1 globally で持つと OK だが、各 box 独立に持つ方が
// instanciation cost が低く、unmount で自動 cleanup できるのでこちらを採用。
function SkeletonBoxImpl({
  width = '100%',
  height = 16,
  borderRadius = R.md,
  style,
}: SkeletonBoxProps) {
  const { isDark } = useTheme();
  const C = useColors();
  const [measuredW, setMeasuredW] = useState<number>(0);
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = 0;
    progress.value = withRepeat(
      withTiming(1, {
        duration: SHIMMER_DURATION_MS,
        // 左右等速感だが端で僅かに緩める — 純 linear だと「カクッ」と
        // ループの繋ぎ目が見える。inOut(quad) で 1 周期を 1 つの呼吸に。
        easing: Easing.inOut(Easing.quad),
      }),
      -1,
      false,
    );
    // unmount 時の cleanup は reanimated が自動でやる (shared value GC)
  }, [progress]);

  const bandStyle = useAnimatedStyle(() => {
    'worklet';
    const w = measuredW || FALLBACK_W;
    // 開始位置: -BAND_W (完全に container 左外) → 終了: w + BAND_W (完全右外)
    const tx = interpolate(progress.value, [0, 1], [-SHIMMER_BAND_WIDTH, w + SHIMMER_BAND_WIDTH]);
    return { transform: [{ translateX: tx }] };
  });

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w && Math.abs(w - measuredW) > 0.5) setMeasuredW(w);
  };

  // band の gradient colors — テーマ別に切替
  //   dark: 透明 → 白 alpha (中央) → 透明
  //   light: 透明 → 黒 alpha (中央, より薄め) → 透明
  // band 中央が一番明るく (or 暗く) なるよう 3 stop。
  const bandColors = useMemo<readonly [string, string, string]>(() => {
    if (isDark) {
      return [
        'rgba(255,255,255,0)',
        'rgba(255,255,255,0.10)',
        'rgba(255,255,255,0)',
      ] as const;
    }
    return [
      'rgba(0,0,0,0)',
      'rgba(0,0,0,0.06)',
      'rgba(0,0,0,0)',
    ] as const;
  }, [isDark]);

  return (
    <View
      onLayout={onLayout}
      style={[
        {
          width,
          height,
          borderRadius,
          backgroundColor: C.bg3,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      <Animated.View
        style={[
          {
            position: 'absolute',
            top: 0,
            bottom: 0,
            width: SHIMMER_BAND_WIDTH,
          },
          bandStyle,
        ]}
      >
        <LinearGradient
          colors={bandColors as unknown as [string, string, string]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={{ flex: 1 }}
        />
      </Animated.View>
    </View>
  );
}

// props 浅比較 — width/height/borderRadius/style ref が同じなら re-render skip。
// 親が頻繁に re-render しても各 SkeletonBox の useEffect は走らない。
export const SkeletonBox = React.memo(SkeletonBoxImpl, (prev, next) => {
  return (
    prev.width === next.width &&
    prev.height === next.height &&
    prev.borderRadius === next.borderRadius &&
    prev.style === next.style
  );
});

export default SkeletonBox;
