import { useEffect } from 'react';
import { View, Text } from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  ZoomIn,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { C, GRAD, R, SIZE } from '../../design/tokens';
import { T } from '../../design/typography';
import { useTheme } from '../../hooks/useColors';
import { thumbedUrl } from '../../lib/utils/imageUrl';

// Threshold above which we add an entrance pop animation.
// Smaller avatars (list rows, post cards) skip the animation to keep
// large lists smooth — only "hero" avatars (mypage, profile) animate.
const POP_THRESHOLD = 56;

// gradient ring の太さ (= padding) — Reddit Premium / IG Story 風の 2px ring
const RING_WIDTH = 2;

// shadow を付与する size しきい値 (lg / xl のみ浮遊感を出す)
const SHADOW_THRESHOLD = SIZE.avatarLg; // 56

// アバター画像のロード幅を size から決定する。
// Supabase Storage の元画像は最大 1600x1600 (lib/image.ts) なので、
// 32px のアバターに 1600px を投げると帯域も decode コストも莫大。
// retina 換算で 3x にしておけば見た目は綺麗 (32px → 96px サムネ)。
// 既知のキャップは 256px (大きい hero avatar 用)。
function avatarThumbWidth(size: number): number {
  const w = Math.max(64, Math.min(256, Math.round(size * 3)));
  return w;
}

// ring kind → gradient colors の解決。
// - 'accent' / 'gold' / 'story' で別の brand ring を出し分け
// - useTheme().GRAD は primary のみ持つので、goldBadge/storyRing は tokens の GRAD から直接引く
//   (これらはテーマ問わず同一の brand 色)
type RingKind = 'none' | 'accent' | 'gold' | 'story';

function resolveRingColors(
  kind: Exclude<RingKind, 'none'>,
  themeGradPrimary: readonly [string, string, string],
): readonly [string, string, ...string[]] {
  if (kind === 'accent') return themeGradPrimary;
  if (kind === 'gold') return GRAD.goldBadge;
  return GRAD.storyRing;
}

// emoji 用 fallback — mount 時に scale 0.6 → 1.0 (spring) でポップさせる。
// worklet safe (useSharedValue + useAnimatedStyle のみ)。
function EmojiInner({ size, emoji, color }: { size: number; emoji: string; color?: string }) {
  const scale = useSharedValue(0.6);

  useEffect(() => {
    // mount 時に spring で 1.0 へ
    scale.value = withSpring(1, { damping: 12, stiffness: 180 });
  }, [scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: R.full,
        backgroundColor: color ?? C.bg3,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Animated.Text style={[{ fontSize: size * 0.55 }, animatedStyle]}>{emoji}</Animated.Text>
    </View>
  );
}

export function Avatar({
  size = 36,
  uri,
  name,
  color,
  emoji,
  anonymous,
  ring = 'none',
}: {
  size?: number;
  uri?: string | null;
  name?: string;
  color?: string;
  emoji?: string | null;
  anonymous?: boolean;
  /**
   * 外周の gradient ring。
   * - 'none' (default): リングなし
   * - 'accent': brand primary グラデ (Reddit Premium 風)
   * - 'gold': 金色グラデ (有料プラン / 公式)
   * - 'story': IG ストーリー風 (紫→桃→琥珀)
   */
  ring?: RingKind;
}) {
  const { GRAD: themeGRAD, SHADOW } = useTheme();
  const shouldPop = size >= POP_THRESHOLD;
  const hasRing = ring !== 'none';
  const hasShadow = size >= SHADOW_THRESHOLD;

  // ring がある時は inner avatar を RING_WIDTH 分縮める (見た目サイズは size を維持)
  const innerSize = hasRing ? size - RING_WIDTH * 2 : size;

  let inner: React.ReactNode;
  if (anonymous) {
    inner = (
      <View
        style={{
          width: innerSize,
          height: innerSize,
          borderRadius: R.full,
          backgroundColor: C.bg3,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: C.border,
        }}
      >
        <Text style={[T.smallM, { color: C.text3, fontSize: innerSize * 0.3 }]}>匿</Text>
      </View>
    );
  } else if (emoji) {
    inner = <EmojiInner size={innerSize} emoji={emoji} color={color} />;
  } else if (uri) {
    // Supabase Storage URL は size に応じたサムネ URL に変換 — 32px アバターに
    // 1600px の元画像を投げないようにする (帯域 + decode コスト削減)。
    // 外部 URL や既にサムネ化済みなら thumbedUrl は no-op。
    const resolvedUri = thumbedUrl(uri, avatarThumbWidth(innerSize));
    inner = (
      <Image
        source={{ uri: resolvedUri }}
        style={{
          width: innerSize,
          height: innerSize,
          borderRadius: R.full,
          backgroundColor: C.bg3,
        }}
        contentFit="cover"
        cachePolicy="memory-disk"
        // List 内で同じセルが別 user のアバターに再利用されるとき、
        // recyclingKey が変われば expo-image が確実に新しい画像を出す。
        recyclingKey={resolvedUri}
        // フェードを短めに (リスト再利用時の二重フェード防止)
        transition={120}
      />
    );
  } else {
    const initial = name?.charAt(0).toUpperCase() ?? '?';
    inner = (
      <View
        style={{
          width: innerSize,
          height: innerSize,
          borderRadius: R.full,
          backgroundColor: color ?? C.accent,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={[T.bodyB, { color: '#fff', fontSize: innerSize * 0.4 }]}>{initial}</Text>
      </View>
    );
  }

  // ring を当てる場合は LinearGradient の円で inner を包む。
  // gradient 円の上に RING_WIDTH の "padding" を取ることで外周だけ色が見える。
  const wrapped = hasRing ? (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: R.full,
        overflow: 'hidden',
      }}
    >
      <LinearGradient
        colors={resolveRingColors(ring, themeGRAD.primary)}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          width: size,
          height: size,
          borderRadius: R.full,
          padding: RING_WIDTH,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {inner}
      </LinearGradient>
    </View>
  ) : (
    inner
  );

  // shadow を付ける場合は最外殻に円形 shadow を当てる (RN は overflow:hidden で shadow が消えるので別 View)。
  const withShadow = hasShadow ? (
    <View style={[{ borderRadius: R.full }, SHADOW.sm]}>{wrapped}</View>
  ) : (
    wrapped
  );

  if (!shouldPop) return <>{withShadow}</>;
  return (
    <Animated.View entering={ZoomIn.duration(180).springify().damping(14)}>
      {withShadow}
    </Animated.View>
  );
}
