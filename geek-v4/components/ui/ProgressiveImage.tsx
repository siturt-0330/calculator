import { Image, type ImageContentFit } from 'expo-image';
import { View, StyleProp, ViewStyle, Platform } from 'react-native';
import { useEffect, useRef, useState } from 'react';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { C, R } from '../../design/tokens';
import { TIMING_NORMAL } from '../../design/motion';

// ============================================================
// ProgressiveImage
// ============================================================
// expo-image with:
//   - blurhash placeholder while loading
//   - fade-in on load complete
//   - optional lazy loading via IntersectionObserver (web only)
//     - reduces initial bandwidth: images outside viewport never fetch
//     - 200px rootMargin so it loads before scroll reaches it
//   - memory-disk cache policy for repeat views
//   - error state with bg3 fallback (no broken icon)
// ============================================================

export function ProgressiveImage({
  uri,
  blurhash,
  width,
  height,
  radius = R.lg,
  contentFit = 'cover',
  style,
  lazy = false,
}: {
  uri: string;
  blurhash?: string;
  width: number | `${number}%` | 'auto';
  height: number | `${number}%` | 'auto';
  radius?: number;
  contentFit?: ImageContentFit;
  style?: StyleProp<ViewStyle>;
  // Web のみ: viewport に入るまで読み込みを遅延 (IntersectionObserver)
  // モバイルでは無視 (FlatList が virtualization で代替)
  lazy?: boolean;
}) {
  const op = useSharedValue(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [shouldLoad, setShouldLoad] = useState(!lazy || Platform.OS !== 'web');
  const wrapperRef = useRef<View | null>(null);
  const a = useAnimatedStyle(() => ({ opacity: op.value }));

  // Web only: IntersectionObserver で遅延読み込み
  useEffect(() => {
    if (!lazy || Platform.OS !== 'web' || shouldLoad) return;
    if (typeof IntersectionObserver === 'undefined') {
      setShouldLoad(true);
      return;
    }
    // React Native Web では View → HTMLDivElement なので getNativeElement で取れる
    const node = (wrapperRef.current as unknown as HTMLElement | null);
    if (!node) {
      setShouldLoad(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShouldLoad(true);
            io.disconnect();
            break;
          }
        }
      },
      { rootMargin: '200px' }, // viewport から 200px 手前で先読み
    );
    io.observe(node);
    return () => io.disconnect();
  }, [lazy, shouldLoad]);

  return (
    <View
      ref={wrapperRef}
      style={[
        { width, height, borderRadius: radius, overflow: 'hidden', backgroundColor: C.bg3 },
        style,
      ]}
    >
      {shouldLoad && !error && (
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
            onError={() => setError(true)}
          />
        </Animated.View>
      )}
    </View>
  );
}
