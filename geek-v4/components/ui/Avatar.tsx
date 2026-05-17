import { View, Text } from 'react-native';
import { Image } from 'expo-image';
import { C, R } from '@/design/tokens';
import { T } from '@/design/typography';

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
  if (anonymous) {
    return (
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
  }
  if (emoji) {
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
        <Text style={{ fontSize: size * 0.55 }}>{emoji}</Text>
      </View>
    );
  }
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: R.full, backgroundColor: C.bg3 }}
        contentFit="cover"
        cachePolicy="memory-disk"
      />
    );
  }
  const initial = name?.charAt(0).toUpperCase() ?? '?';
  return (
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
