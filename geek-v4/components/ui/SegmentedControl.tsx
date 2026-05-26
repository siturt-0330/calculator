import { View, Text, LayoutChangeEvent } from 'react-native';
import { useState, useEffect } from 'react';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { PressableScale } from './PressableScale';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { SPRING_TIGHT } from '../../design/motion';

// container の内側 padding. indicator が container の rounded edge をはみ出さないように
// 全方向 (top/bottom/left/right) で同じ値を使う + segW を inner width で計算する.
const PAD = 3;

export function SegmentedControl<V extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: V; label: string }[];
  value: V;
  onChange: (v: V) => void;
}) {
  const [w, setW] = useState(0);
  // ★ padding を引いた inner area の幅でセグメント幅を算出.
  //   w (= 全幅) で割ると, 末尾セグメントの indicator が右端 PAD だけ container の rounded
  //   border をはみ出す現象が起きる. inner area で計算すれば indicator は container の内側に
  //   ちゃんと収まる.
  const innerW = Math.max(0, w - PAD * 2);
  const segW = innerW / options.length;
  const idx = options.findIndex((o) => o.value === value);
  const x = useSharedValue(0);

  useEffect(() => {
    if (segW > 0) x.value = withSpring(idx * segW, SPRING_TIGHT);
  }, [idx, segW, x]);

  const a = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }], width: segW }));

  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}
      style={{
        flexDirection: 'row',
        backgroundColor: C.bg3,
        borderRadius: R.full,
        padding: PAD,
        position: 'relative',
        // safety net — indicator が万一はみ出ても rounded shape で clip する
        overflow: 'hidden',
      }}
    >
      <Animated.View
        style={[
          {
            position: 'absolute',
            top: PAD,
            bottom: PAD,
            // indicator の left を PAD に固定 (translateX 0 のときに左 PAD から始まる)
            left: PAD,
            borderRadius: R.full,
            backgroundColor: C.bg5,
          },
          a,
        ]}
      />
      {options.map((o) => (
        <PressableScale
          key={o.value}
          onPress={() => onChange(o.value)}
          haptic="select"
          style={{ flex: 1, paddingVertical: SP['2'], alignItems: 'center' }}
        >
          <Text style={[T.smallM, { color: value === o.value ? C.text : C.text2 }]}>
            {o.label}
          </Text>
        </PressableScale>
      ))}
    </View>
  );
}
