import { Image, type ImageContentFit } from 'expo-image';
import { View, StyleProp, ViewStyle, Platform } from 'react-native';
import { useEffect, useRef, useState } from 'react';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { C, R } from '../../design/tokens';
import { TIMING_NORMAL } from '../../design/motion';
import { thumbedUrl } from '../../lib/utils/imageUrl';

// ============================================================
// ProgressiveImage
// ============================================================
// expo-image with:
//   - blurhash placeholder while loading
//   - fade-in on load complete (transition 200ms — pop-in 防止)
//   - Supabase Storage URL は自動的に 720px サムネに変換
//     (元画像は最大 1600px なので帯域 1/4 以下に削減、ロード劇的に速くなる)
//   - optional lazy loading via IntersectionObserver (web only)
//     - reduces initial bandwidth: images outside viewport never fetch
//     - 200px rootMargin so it loads before scroll reaches it
//   - memory-disk cache policy for repeat views
//   - placeholder bg = C.bg3 (黒ではなくニュートラルなダークグレー)
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
  // ロード時のサムネサイズ (Supabase render endpoint 経由)。
  // フィード用なら 720 が綺麗 + 軽い、フルスクリーンなら 1280 等。
  thumbWidth = 720,
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
  thumbWidth?: number;
}) {
  // blurhash がある場合は最初から opacity=1 で blurhash 自体を見せる。
  // 無い場合は 0 → 1 でフェードイン (画面が突然 pop-in しない)。
  const hasBlurhash = !!blurhash;
  const op = useSharedValue(hasBlurhash ? 1 : 0);
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

  // Supabase Storage URL は render endpoint に変換 (帯域削減)。
  // 既に外部 CDN や別ホストの URL はそのまま使われる。
  const resolvedUri = thumbedUrl(uri, thumbWidth);

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
            source={{ uri: resolvedUri }}
            placeholder={blurhash ? { blurhash } : undefined}
            placeholderContentFit={contentFit}
            style={{ width: '100%', height: '100%' }}
            contentFit={contentFit}
            // expo-image 自体のクロスフェード (短め — 二重 fade 回避)
            transition={150}
            cachePolicy="memory-disk"
            recyclingKey={resolvedUri}
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
