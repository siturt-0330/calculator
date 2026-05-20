import { memo, useEffect } from 'react';
import { View, Text, ScrollView } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { fetchTrendingTags } from '@/lib/api/trending';
import { attachChannel } from '@/lib/realtime';
import { PressableScale } from '@/components/ui/PressableScale';
import { C, R, SP } from '@/design/tokens';
import { T } from '@/design/typography';

function TrendingRowInner() {
  const router = useRouter();
  const qc = useQueryClient();

  const { data: trending = [] } = useQuery({
    queryKey: ['trending-tags'],
    queryFn: () => fetchTrendingTags(10),
    staleTime: 5 * 60 * 1000,  // 5分
    refetchOnMount: false,
  });

  // Realtime: 新規投稿があったらトレンドを refresh (debounce)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const detach = attachChannel('trending-tags-refresh', (ch) =>
      ch.on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'posts' },
        () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            qc.invalidateQueries({ queryKey: ['trending-tags'] });
          }, 8000);
        },
      ),
    );
    return () => {
      detach();
      if (timer) clearTimeout(timer);
    };
  }, [qc]);

  if (trending.length === 0) return null;

  return (
    <Animated.View
      entering={FadeIn.duration(300).delay(80)}
      style={{ alignItems: 'center', backgroundColor: C.bg }}
    >
      <View style={{ width: '100%', maxWidth: 720, paddingHorizontal: SP['4'], paddingTop: SP['2'], paddingBottom: SP['3'] }}>
        <Text style={[T.caption, { color: C.text3, letterSpacing: 0.5, marginBottom: SP['2'] }]}>
          トレンド
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: SP['2'], paddingRight: SP['4'] }}
        >
          {trending.map((t, i) => (
            <PressableScale
              key={t.name}
              onPress={() => router.push(`/tag/${encodeURIComponent(t.name)}` as never)}
              haptic="tap"
              style={{
                paddingHorizontal: SP['3'],
                paddingVertical: SP['2'],
                backgroundColor: i === 0 ? 'rgba(255,140,48,0.18)' : C.bg2,
                borderRadius: R.full,
                borderWidth: 1,
                borderColor: i === 0 ? 'rgba(255,140,48,0.5)' : C.border,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {i === 0 && <Text style={{ fontSize: 11 }}>👑</Text>}
              <Text style={[T.smallM, { color: i === 0 ? '#FF8C30' : C.text, fontWeight: '700' }]}>
                #{t.name}
              </Text>
              <View style={{
                paddingHorizontal: 6, paddingVertical: 1,
                backgroundColor: i === 0 ? 'rgba(255,140,48,0.3)' : C.bg3,
                borderRadius: R.sm,
              }}>
                <Text style={{ fontSize: 10, color: i === 0 ? '#FF8C30' : C.text3, fontWeight: '700' }}>
                  +{t.postCount}
                </Text>
              </View>
            </PressableScale>
          ))}
        </ScrollView>
      </View>
    </Animated.View>
  );
}

export const TrendingRow = memo(TrendingRowInner);
