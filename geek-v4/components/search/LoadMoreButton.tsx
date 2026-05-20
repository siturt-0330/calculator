// 検索結果リストの末尾に表示する「さらに読み込む」ボタン。
//
// - !hasMore のときは null を返して何も表示しない。
// - loading 中は ActivityIndicator + ボタンを disabled にし、二重発火を防ぐ。
// - スタイルは他の secondary ボタンと揃える (glass / border)。

import { View, Text, ActivityIndicator } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { PressableScale } from '@/components/ui/PressableScale';
import { C, R, SP } from '@/design/tokens';
import { T } from '@/design/typography';

type Props = {
  onPress: () => void;
  loading?: boolean;
  hasMore: boolean;
};

export function LoadMoreButton({ onPress, loading = false, hasMore }: Props) {
  if (!hasMore) return null;
  return (
    <View
      style={{
        paddingHorizontal: SP['4'],
        paddingVertical: SP['4'],
        alignItems: 'center',
      }}
    >
      <PressableScale
        onPress={loading ? undefined : onPress}
        disabled={loading}
        haptic="tap"
        accessibilityRole="button"
        accessibilityLabel="さらに読み込む"
        accessibilityState={{ disabled: loading, busy: loading }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: SP['2'],
          minWidth: 180,
          paddingHorizontal: SP['5'],
          paddingVertical: SP['3'],
          borderRadius: R.full,
          backgroundColor: C.glass,
          borderWidth: 1,
          borderColor: C.glassBorder,
          opacity: loading ? 0.7 : 1,
        }}
      >
        {loading ? (
          <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)}>
            <ActivityIndicator size="small" color={C.text2} />
          </Animated.View>
        ) : null}
        <Text style={[T.bodyM, { color: C.text }]}>さらに読み込む</Text>
      </PressableScale>
    </View>
  );
}
