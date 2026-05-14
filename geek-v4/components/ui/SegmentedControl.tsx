import { View, Text, LayoutChangeEvent } from 'react-native';
import { useState, useEffect } from 'react';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { PressableScale } from './PressableScale';
import { C, R, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import { SPRING_TIGHT } from '@/design/motion';

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
  const segW = w / options.length;
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
        padding: 3,
        position: 'relative',
      }}
    >
      <Animated.View
        style={[
          {
            position: 'absolute',
            top: 3,
            bottom: 3,
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
