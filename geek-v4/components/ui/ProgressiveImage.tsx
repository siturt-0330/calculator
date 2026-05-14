import { Image, type ImageContentFit } from 'expo-image';
import { View, StyleProp, ViewStyle } from 'react-native';
import { useState } from 'react';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { C, R } from '@/design/tokens';
import { TIMING_NORMAL } from '@/design/motion';

export function ProgressiveImage({
  uri,
  blurhash,
  width,
  height,
  radius = R.lg,
  contentFit = 'cover',
  style,
}: {
  uri: string;
  blurhash?: string;
  width: number | `${number}%` | 'auto';
  height: number | `${number}%` | 'auto';
  radius?: number;
  contentFit?: ImageContentFit;
  style?: StyleProp<ViewStyle>;
}) {
  const op = useSharedValue(0);
  const [loaded, setLoaded] = useState(false);
  const a = useAnimatedStyle(() => ({ opacity: op.value }));

  return (
    <View
      style={[
        { width, height, borderRadius: radius, overflow: 'hidden', backgroundColor: C.bg3 },
        style,
      ]}
    >
      <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }, a]}>
        <Image
          source={{ uri }}
          placeholder={blurhash ? { blurhash } : undefined}
          style={{ width: '100%', height: '100%' }}
          contentFit={contentFit}
          transition={0}
          cachePolicy="memory-disk"
          onLoadEnd={() => {
            if (!loaded) {
              setLoaded(true);
              op.value = withTiming(1, TIMING_NORMAL);
            }
          }}
        />
      </Animated.View>
    </View>
  );
}
