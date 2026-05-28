import { Image, type ImageContentFit } from 'expo-image';
import { View, StyleProp, ViewStyle, Platform } from 'react-native';
import { useEffect, useRef, useState } from 'react';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import { R } from '../../design/tokens';
import { EASE_OUT_QUART } from '../../design/motion';
import { Icon } from '../../constants/icons';
import { useColors } from '../../hooks/useColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { thumbedUrl } from '../../lib/utils/imageUrl';

// ============================================================
// ProgressiveImage — Apple News 風 polish
// ============================================================
// 二層 crossfade:
//   1. 下層 (blurhash placeholder) を最初から表示
//   2. 本画像 onLoad → 480ms `withTiming(opacity, easeOutQuart)` で浮き上がる
//   3. blurhash は 200ms hold → 240ms で 0.8 → 0 へ溶ける
//      (sharp が完全に乗ったあとから抜く = pop-in と flicker を同時回避)
//
// ken-burns ライクな静かな motion:
//   - 本画像 mount 時 scale 1.04 → 1.0 を 600ms ease-out で
//   - 大きすぎず Apple News の "息づく" 静止画感
//
// 失敗 fallback:
//   - 本画像 onError → 透明にせず blurhash を留め、中央に Icon.image (op 0.5)
//
// reduceMotion (useSettingsStore) true の時:
//   - fade / scale / hold ぜんぶ skip して即 swap (worklet-safe)
//
// 既存の expo-image transition prop は粗いので使わない (transition=0)。
// Worklet で書き直し、Web / Native で同一挙動。
//
// 既存仕様 (踏襲):
//   - Supabase Storage URL は 720px サムネに自動変換 (帯域削減)
//   - Web のみ IntersectionObserver で lazy load (200px rootMargin)
//   - memory-disk cache policy
//   - placeholder bg = C.bg3
// ============================================================

// 動きトークン (この component 専用 — 他で再利用しない私的調律)
const SHARP_FADE_MS = 480;
const SHARP_SCALE_MS = 600;
const BLUR_HOLD_MS = 200;
const BLUR_FADE_MS = 240;
const SCALE_FROM = 1.04;
const SCALE_TO = 1.0;
const BLUR_BASE_OP = 0.8; // sharp 出現中の blurhash 不透明度 — flicker 回避

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
  const C = useColors();
  const reduceMotion = useReducedMotion();
  const hasBlurhash = !!blurhash;

  // Animated values
  //   sharpOp  — 本画像 opacity (0 → 1)
  //   blurOp   — blurhash opacity (1 → 0、ただし error 時は据え置き)
  //   sharpSc  — 本画像 scale (1.04 → 1.0)
  const sharpOp = useSharedValue(0);
  const blurOp = useSharedValue(hasBlurhash ? 1 : 0);
  const sharpSc = useSharedValue(SCALE_FROM);

  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [shouldLoad, setShouldLoad] = useState(!lazy || Platform.OS !== 'web');
  const wrapperRef = useRef<View | null>(null);

  const sharpStyle = useAnimatedStyle(() => ({
    opacity: sharpOp.value,
    transform: [{ scale: sharpSc.value }],
  }));
  const blurStyle = useAnimatedStyle(() => ({ opacity: blurOp.value }));

  // Web only: IntersectionObserver で遅延読み込み
  useEffect(() => {
    if (!lazy || Platform.OS !== 'web' || shouldLoad) return;
    if (typeof IntersectionObserver === 'undefined') {
      setShouldLoad(true);
      return;
    }
    // React Native Web では View → HTMLDivElement
    const node = wrapperRef.current as unknown as HTMLElement | null;
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

  const handleLoadEnd = () => {
    if (loaded || error) return;
    setLoaded(true);
    if (reduceMotion) {
      // 即 swap — fade / scale / hold ぜんぶ skip
      sharpOp.value = 1;
      sharpSc.value = SCALE_TO;
      blurOp.value = 0;
      return;
    }
    // 本画像: 0 → 1 を easeOutQuart で 480ms
    sharpOp.value = withTiming(1, { duration: SHARP_FADE_MS, easing: EASE_OUT_QUART });
    // scale: 1.04 → 1.0 を 600ms ease-out (静かな ken-burns)
    sharpSc.value = withTiming(SCALE_TO, {
      duration: SHARP_SCALE_MS,
      easing: Easing.out(Easing.cubic),
    });
    // blurhash: 0.8 で 200ms hold → 240ms で 0 へ
    //   = 本画像が乗ったあとに溶ける = flicker 0
    if (hasBlurhash) {
      blurOp.value = withTiming(BLUR_BASE_OP, { duration: 1 }); // 即 0.8 に落とす
      blurOp.value = withDelay(
        BLUR_HOLD_MS,
        withTiming(0, { duration: BLUR_FADE_MS, easing: EASE_OUT_QUART }),
      );
    }
  };

  const handleError = () => {
    setError(true);
    // blurhash は留め置く (透明にしない)。
    // reduceMotion は無関係 — error 経路に animation 無し。
    if (hasBlurhash) {
      blurOp.value = 1;
    }
    sharpOp.value = 0;
  };

  return (
    <View
      ref={wrapperRef}
      style={[
        { width, height, borderRadius: radius, overflow: 'hidden', backgroundColor: C.bg3 },
        style,
      ]}
    >
      {/* 下層: blurhash placeholder */}
      {/*  - source 無し = blurhash のみ描画 (expo-image native impl)
          - error 時もここは残るので背景として機能する */}
      {hasBlurhash && (
        <Animated.View
          pointerEvents="none"
          style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }, blurStyle]}
        >
          <Image
            // source 空 → placeholder だけが見える状態を作る
            source={null}
            placeholder={{ blurhash }}
            placeholderContentFit={contentFit}
            style={{ width: '100%', height: '100%' }}
            contentFit={contentFit}
            transition={0}
          />
        </Animated.View>
      )}

      {/* 上層: 本画像 (load 完了で fade + scale) */}
      {shouldLoad && !error && (
        <Animated.View
          style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }, sharpStyle]}
        >
          <Image
            source={{ uri: resolvedUri }}
            // 上層側では placeholder 不要 (下層が担当)。blurhash 無いケースでも
            // 透明な空 placeholder を割り当てて pop-in を防ぐ。
            placeholder={hasBlurhash ? undefined : { blurhash: 'L6Pj0^jE.AyE_3t7t7R**0o#DgR4' }}
            placeholderContentFit={contentFit}
            style={{ width: '100%', height: '100%' }}
            contentFit={contentFit}
            // expo-image 内蔵 transition は使わない (二重 fade 回避)
            transition={0}
            cachePolicy="memory-disk"
            recyclingKey={resolvedUri}
            onLoadEnd={handleLoadEnd}
            onError={handleError}
          />
        </Animated.View>
      )}

      {/* エラー時: 中央に淡い image icon (blurhash を背景に残したまま) */}
      {error && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon.image size={28} color={C.text3} style={{ opacity: 0.5 }} />
        </View>
      )}
    </View>
  );
}
