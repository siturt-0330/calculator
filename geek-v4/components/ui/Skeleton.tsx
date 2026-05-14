import { MotiView } from 'moti';
import { DimensionValue, ViewStyle } from 'react-native';
import { C, R } from '@/design/tokens';
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
