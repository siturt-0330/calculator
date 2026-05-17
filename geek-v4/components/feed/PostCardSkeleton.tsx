import { View } from 'react-native';
import { Skeleton, SkeletonCircle } from '@/components/ui/Skeleton';
import { C, R, SP } from '@/design/tokens';

export function PostCardSkeleton() {
  return (
    <View style={{
      backgroundColor: C.bg2,
      marginHorizontal: SP['3'],
      marginBottom: SP['4'],
      borderRadius: R.lg,
      borderWidth: 1,
      borderColor: C.border,
      padding: SP['4'],
      gap: SP['3'],
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
        <SkeletonCircle size={24} />
        <Skeleton width={80} height={14} />
        <Skeleton width={50} height={12} />
        <View style={{ flex: 1 }} />
        <Skeleton width={14} height={14} radius={7} />
      </View>
      <Skeleton width="100%" height={16} />
      <Skeleton width="80%" height={16} />
      <Skeleton width="60%" height={16} />
      <View style={{ flexDirection: 'row', gap: SP['4'], marginTop: SP['1'] }}>
        <Skeleton width={32} height={20} radius={10} />
        <Skeleton width={32} height={20} radius={10} />
        <Skeleton width={32} height={20} radius={10} />
      </View>
    </View>
  );
}
