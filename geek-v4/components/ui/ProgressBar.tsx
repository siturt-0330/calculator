import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useEffect } from 'react';
import { C, R } from '../../design/tokens';
import { SPRING_GENTLE } from '../../design/motion';

// transform: scaleX で進捗バーを伸ばす実装。
// 旧実装は `width: ${p}%` を Reanimated でアニメさせていたが、
// `width` はレイアウトプロパティで毎フレーム再レイアウトが走り、native では
// UI thread を経由しても結局重い (web では CSS が補正してくれるが、
// 端末によっては fps が出ない)。
// scaleX 変換なら GPU 合成だけで済むので native も web も常に 60fps。
//
// アンカーは左端固定 (transformOrigin: 'left' / RN web は marginRight トリックは不要 —
// `transform: scaleX(p)` をフルワイドの絶対配置 child に当てて、親の overflow:hidden で
// クリップする方式)
export function ProgressBar({
  value,
  height = 4,
  color = C.accent,
}: {
  value: number; // 0-100
  height?: number;
  color?: string;
}) {
  const progress = useSharedValue(0);
  useEffect(() => {
    const clamped = Math.min(Math.max(value, 0), 100) / 100;
    progress.value = withSpring(clamped, SPRING_GENTLE);
  }, [value, progress]);
  // 子は親と同じ幅 (100%) で描き、scaleX(0..1) で右方向に伸ばす。
  // transformOrigin: 'left center' で左端を基準点にする (RN >= 0.74)。
  const a = useAnimatedStyle(() => ({
    transform: [{ scaleX: progress.value }],
  }));

  return (
    <View
      style={{
        height,
        borderRadius: R.full,
        backgroundColor: C.bg3,
        overflow: 'hidden',
      }}
    >
      <Animated.View
        // transformOrigin で左端基準にする (RN >= 0.73 / Reanimated 3 でサポート)。
        // web では CSS transform-origin に変換される。
        style={[
          {
            height: '100%',
            width: '100%',
            borderRadius: R.full,
            backgroundColor: color,
            transformOrigin: 'left center',
          },
          a,
        ]}
      />
    </View>
  );
}
