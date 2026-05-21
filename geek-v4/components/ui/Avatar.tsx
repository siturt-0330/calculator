import { View, Text } from 'react-native';
import { Image } from 'expo-image';
import Animated, { ZoomIn } from 'react-native-reanimated';
import { C, R } from '../../design/tokens';
import { T } from '../../design/typography';
import { thumbedUrl } from '../../lib/utils/imageUrl';

// Threshold above which we add an entrance pop animation.
// Smaller avatars (list rows, post cards) skip the animation to keep
// large lists smooth — only "hero" avatars (mypage, profile) animate.
const POP_THRESHOLD = 56;

// アバター画像のロード幅を size から決定する。
// Supabase Storage の元画像は最大 1600x1600 (lib/image.ts) なので、
// 32px のアバターに 1600px を投げると帯域も decode コストも莫大。
// retina 換算で 3x にしておけば見た目は綺麗 (32px → 96px サムネ)。
// 既知のキャップは 256px (大きい hero avatar 用)。
function avatarThumbWidth(size: number): number {
  const w = Math.max(64, Math.min(256, Math.round(size * 3)));
  return w;
}

export function Avatar({
  size = 36,
  uri,
  name,
  color,
  emoji,
  anonymous,
}: {
  size?: number;
  uri?: string | null;
  name?: string;
  color?: string;
  emoji?: string | null;
  anonymous?: boolean;
}) {
  const shouldPop = size >= POP_THRESHOLD;

  let inner: React.ReactNode;
  if (anonymous) {
    inner = (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: R.full,
          backgroundColor: C.bg3,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: C.border,
        }}
      >
        <Text style={[T.smallM, { color: C.text3, fontSize: size * 0.3 }]}>匿</Text>
      </View>
    );
  } else if (emoji) {
    inner = (
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
        <Text style={{ fontSize: size * 0.55 }}>{emoji}</Text>
      </View>
    );
  } else if (uri) {
    // Supabase Storage URL は size に応じたサムネ URL に変換 — 32px アバターに
    // 1600px の元画像を投げないようにする (帯域 + decode コスト削減)。
    // 外部 URL や既にサムネ化済みなら thumbedUrl は no-op。
    const resolvedUri = thumbedUrl(uri, avatarThumbWidth(size));
    inner = (
      <Image
        source={{ uri: resolvedUri }}
        style={{ width: size, height: size, borderRadius: R.full, backgroundColor: C.bg3 }}
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
          width: size,
          height: size,
          borderRadius: R.full,
          backgroundColor: color ?? C.accent,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={[T.bodyB, { color: '#fff', fontSize: size * 0.4 }]}>{initial}</Text>
      </View>
    );
  }

  if (!shouldPop) return <>{inner}</>;
  return (
    <Animated.View entering={ZoomIn.duration(180).springify().damping(14)}>
      {inner}
    </Animated.View>
  );
}
