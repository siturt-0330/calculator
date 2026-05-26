import { useEffect, useState } from 'react';
import { View, DimensionValue, ViewStyle, LayoutChangeEvent } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  interpolate,
} from 'react-native-reanimated';
import { C, R, SP } from '../../design/tokens';

// Smooth left-to-right shimmer skeleton.
// - Uses a sliding highlight band over a dim base
// - Reanimated based; cheap on the UI thread
// - API kept backward-compatible with the previous Skeleton primitive so
//   existing call-sites (ThreadCardSkeleton, MypageSkeleton, NotificationSkeleton,
//   PostCardSkeleton) keep working with zero changes.
const SHIMMER_BAND_WIDTH = 96;
const SHIMMER_DURATION_MS = 1400;

export function Skeleton({
  width = '100%',
  height = 16,
  radius,
  borderRadius,
  style,
}: {
  width?: DimensionValue;
  height?: number;
  /** 既存 API (`radius`) — 後方互換のため残す */
  radius?: number;
  /** 新規 API (`borderRadius`) — UI Polish (Phase 2) の SkeletonRow 等から使用。指定があれば radius より優先 */
  borderRadius?: number;
  style?: ViewStyle;
}) {
  // borderRadius が指定されればそれ、無ければ radius、どちらも無ければ R.md (legacy default)
  const effectiveRadius = borderRadius ?? radius ?? R.md;
  // Track measured width so the shimmer band sweeps fully across.
  const [measuredW, setMeasuredW] = useState<number>(0);
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, { duration: SHIMMER_DURATION_MS, easing: Easing.bezier(0.4, 0, 0.6, 1) }),
      -1,
      false,
    );
  }, [progress]);

  const bandStyle = useAnimatedStyle(() => {
    const w = measuredW || 200;
    const tx = interpolate(progress.value, [0, 1], [-SHIMMER_BAND_WIDTH, w + SHIMMER_BAND_WIDTH]);
    return { transform: [{ translateX: tx }] };
  });

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w && w !== measuredW) setMeasuredW(w);
  };

  return (
    <View
      onLayout={onLayout}
      style={[
        {
          width,
          height,
          borderRadius: effectiveRadius,
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
            backgroundColor: 'rgba(255,255,255,0.06)',
          },
          bandStyle,
        ]}
      />
    </View>
  );
}

export function SkeletonCircle({ size = 36 }: { size?: number }) {
  return <Skeleton width={size} height={size} radius={9999} />;
}

// BBS スレッドカード のスケルトン
export function ThreadCardSkeleton() {
  return (
    <View style={{
      paddingHorizontal: SP['4'], paddingBottom: SP['3'],
      maxWidth: 720, alignSelf: 'center', width: '100%',
    }}>
      <View style={{
        flexDirection: 'row',
        borderRadius: R.lg,
        backgroundColor: C.bg2,
        borderWidth: 1, borderColor: C.border,
        overflow: 'hidden',
      }}>
        <View style={{ width: 4, backgroundColor: C.bg3 }} />
        <View style={{ flex: 1, padding: SP['3'], gap: SP['2'] }}>
          <Skeleton width={60} height={16} radius={6} />
          <Skeleton width="100%" height={18} />
          <Skeleton width="70%" height={18} />
          <View style={{ flexDirection: 'row', gap: SP['3'] }}>
            <Skeleton width={32} height={12} />
            <Skeleton width={48} height={12} />
          </View>
        </View>
      </View>
    </View>
  );
}

// 通知アイテム のスケルトン
export function NotificationSkeleton() {
  return (
    <View style={{
      flexDirection: 'row',
      padding: SP['4'],
      gap: SP['3'],
      borderBottomWidth: 1,
      borderBottomColor: C.border,
    }}>
      <SkeletonCircle size={36} />
      <View style={{ flex: 1, gap: 4 }}>
        <Skeleton width="80%" height={14} />
        <Skeleton width="40%" height={11} />
      </View>
    </View>
  );
}

// マイページのスケルトン
export function MypageSkeleton() {
  return (
    <View style={{ padding: SP['4'], gap: SP['4'] }}>
      <View style={{ alignItems: 'center', gap: SP['2'] }}>
        <SkeletonCircle size={100} />
        <Skeleton width={120} height={20} />
        <Skeleton width={80} height={12} />
      </View>
      <View style={{
        flexDirection: 'row', justifyContent: 'space-around',
        padding: SP['4'], backgroundColor: C.bg2, borderRadius: R.xl,
        borderWidth: 1, borderColor: C.border,
      }}>
        {[0, 1, 2].map((i) => (
          <View key={`skel-stat-${i}`} style={{ alignItems: 'center', gap: 4 }}>
            <Skeleton width={40} height={24} />
            <Skeleton width={36} height={10} />
          </View>
        ))}
      </View>
    </View>
  );
}
