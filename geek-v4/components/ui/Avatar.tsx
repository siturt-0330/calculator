import { View, Text } from 'react-native';
import { Image } from 'expo-image';
import Animated, { ZoomIn } from 'react-native-reanimated';
import { C, R } from '../../design/tokens';
import { T } from '../../design/typography';

// Threshold above which we add an entrance pop animation.
// Smaller avatars (list rows, post cards) skip the animation to keep
// large lists smooth — only "hero" avatars (mypage, profile) animate.
const POP_THRESHOLD = 56;

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
    inner = (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: R.full, backgroundColor: C.bg3 }}
        contentFit="cover"
        cachePolicy="memory-disk"
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
