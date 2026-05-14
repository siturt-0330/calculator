import { View, Text, FlatList } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBBS } from '@/hooks/useBBS';
import { TopBar } from '@/components/nav/TopBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/constants/icons';
import { C, R, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import { TABBAR } from '@/design/tabbar';
import { formatRelative } from '@/lib/utils/date';

export default function BBSScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { threads, loading } = useBBS();
  const Plus = Icon.plus;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar
        title="掲示板"
        large
        right={
          <PressableScale
            onPress={() => router.push('/bbs/create' as never)}
            style={{ padding: SP['2'] }}
          >
            <Plus size={22} color={C.text} strokeWidth={2.2} />
          </PressableScale>
        }
      />

      <FlatList
        data={threads}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{
          padding: SP['4'],
          gap: SP['3'],
          paddingBottom: TABBAR.height + insets.bottom + SP['10'],
        }}
        renderItem={({ item }) => (
          <PressableScale
            onPress={() => router.push(`/bbs/thread/${item.id}` as never)}
            style={{
              padding: SP['4'],
              borderRadius: R.lg,
              backgroundColor: C.bg2,
              borderWidth: 1,
              borderColor: C.border,
              gap: SP['2'],
            }}
          >
            <Text style={[T.h4, { color: C.text }]} numberOfLines={2}>
              {item.title}
            </Text>
            <View style={{ flexDirection: 'row', gap: SP['3'] }}>
              <Text style={[T.small, { color: C.text3 }]}>{item.replies_count}件</Text>
              <Text style={[T.small, { color: C.text3 }]}>
                {formatRelative(item.last_reply_at ?? item.created_at)}
              </Text>
            </View>
          </PressableScale>
        )}
        ListEmptyComponent={
          !loading ? (
            <EmptyState
              icon={Icon.bbs}
              title="まだスレッドがありません"
              message="新しい話題を始めてみよう"
              actionLabel="スレ立て"
              onAction={() => router.push('/bbs/create' as never)}
            />
          ) : null
        }
      />
    </View>
  );
}
