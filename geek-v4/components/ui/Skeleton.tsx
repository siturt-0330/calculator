import { View, DimensionValue, ViewStyle } from 'react-native';
import { useColors } from '../../hooks/useColors';
import { R, SP } from '../../design/tokens';
import { SkeletonBox } from './SkeletonBox';

// ============================================================
// Skeleton — shimmer 付きの dimming プレースホルダ
// ------------------------------------------------------------
// 実装は SkeletonBox primitive (LinearGradient + Reanimated translateX) に
// 委譲。本ファイルは backward-compatible な薄い wrapper + 用途別テンプレ群。
//
// API 互換:
//   - 既存呼び出し (ThreadCardSkeleton / MypageSkeleton / NotificationSkeleton /
//     PostCardSkeleton / SkeletonCircle / app/admin/* / app/(tabs)/community/discover)
//     は変更ゼロで動く
//   - props: width / height / radius (legacy) / borderRadius (新) / style
//   - radius と borderRadius の両方が指定された場合は borderRadius を優先
// ============================================================

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
  return (
    <SkeletonBox
      width={width}
      height={height}
      borderRadius={effectiveRadius}
      style={style}
    />
  );
}

export function SkeletonCircle({ size = 36 }: { size?: number }) {
  return <SkeletonBox width={size} height={size} borderRadius={9999} />;
}

// BBS スレッドカード のスケルトン
export function ThreadCardSkeleton() {
  const C = useColors();
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
  const C = useColors();
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
  const C = useColors();
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
