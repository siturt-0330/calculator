import { MotiView } from 'moti';
import { View, DimensionValue, ViewStyle } from 'react-native';
import { C, R, SP } from '@/design/tokens';
import { SHIMMER_DURATION } from '@/design/motion';

export function Skeleton({
  width = '100%',
  height = 16,
  radius = R.md,
  style,
}: {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: ViewStyle;
}) {
  return (
    <MotiView
      from={{ opacity: 0.35 }}
      animate={{ opacity: 0.7 }}
      transition={{ type: 'timing', duration: SHIMMER_DURATION, loop: true, repeatReverse: true }}
      style={[{ width, height, borderRadius: radius, backgroundColor: C.bg3 }, style]}
    />
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
          <View key={i} style={{ alignItems: 'center', gap: 4 }}>
            <Skeleton width={40} height={24} />
            <Skeleton width={36} height={10} />
          </View>
        ))}
      </View>
    </View>
  );
}
