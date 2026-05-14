import { useCallback, useRef } from 'react';
import { View, Text, RefreshControl } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFeed } from '@/hooks/useFeed';
import { useTagFilter } from '@/hooks/useTagFilter';
import { useLike } from '@/hooks/useLike';
import { useSave } from '@/hooks/useSave';
import { AnonPostCard } from '@/components/feed/AnonPostCard';
import { FeedHeader } from '@/components/feed/FeedHeader';
import { BlockedTagBanner } from '@/components/feed/BlockedTagBanner';
import { PressableScale } from '@/components/ui/PressableScale';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/constants/icons';
import { C, SP } from '@/design/tokens';
import { FONT, T } from '@/design/typography';
import { TABBAR } from '@/design/tabbar';
import type { Post } from '@/types/models';

export default function FeedScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { posts, loading, refreshing, refresh, loadMore } = useFeed();
  const { likedTags, blockedCount } = useTagFilter();
  const { toggle: toggleLike } = useLike();
  const { toggle: toggleSave } = useSave();
  const listRef = useRef<FlashList<Post>>(null);

  const renderItem = useCallback(
    ({ item }: { item: Post }) => (
      <AnonPostCard
        post={item}
        onLike={() => toggleLike(item.id)}
        onComment={() => router.push(`/post/${item.id}` as never)}
        onSave={() => toggleSave(item.id)}
        onShare={() => {}}
        onTagPress={(name) => router.push(`/tag/${encodeURIComponent(name)}` as never)}
        onMore={() => {}}
      />
    ),
    [router, toggleLike, toggleSave],
  );

  const Bell = Icon.bell;
  const Filter = Icon.filter;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* ヘッダーバー */}
      <View
        style={{
          paddingTop: insets.top + SP['2'],
          paddingHorizontal: SP['4'],
          paddingBottom: SP['3'],
          flexDirection: 'row',
          alignItems: 'center',
          borderBottomWidth: 1,
          borderBottomColor: C.border,
          backgroundColor: C.bg,
        }}
      >
        <Text
          style={[
            {
              flex: 1,
              fontFamily: FONT.display,
              fontSize: 28,
              color: C.text,
              letterSpacing: -0.5,
            },
          ]}
        >
          Geek
        </Text>
        <PressableScale
          onPress={() => router.push('/filter' as never)}
          style={{ padding: SP['2'] }}
        >
          <Filter size={22} color={C.text} strokeWidth={2.2} />
        </PressableScale>
        <PressableScale
          onPress={() => router.push('/notifications' as never)}
          style={{ padding: SP['2'] }}
        >
          <Bell size={22} color={C.text} strokeWidth={2.2} />
        </PressableScale>
      </View>

      <FlashList
        ref={listRef}
        data={posts}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        estimatedItemSize={600}
        ListHeaderComponent={
          <>
            <FeedHeader
              tags={likedTags.map((n) => ({ name: n }))}
              onTagPress={(name) => router.push(`/tag/${encodeURIComponent(name)}` as never)}
              onAddPress={() => router.push('/filter' as never)}
            />
            {blockedCount > 0 && (
              <BlockedTagBanner
                count={blockedCount}
                onPress={() => router.push('/filter' as never)}
              />
            )}
          </>
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={C.accent}
          />
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
        contentContainerStyle={{
          paddingBottom: TABBAR.height + insets.bottom + SP['10'],
        }}
        ListEmptyComponent={
          loading ? (
            <FeedSkeleton />
          ) : (
            <EmptyState
              icon={Icon.sparkles}
              title="まだ投稿がありません"
              message="フィルター設定を確認するか、最初の投稿をしてみよう"
              actionLabel="投稿する"
              onAction={() => router.push('/post/create' as never)}
            />
          )
        }
      />
    </View>
  );
}

function FeedSkeleton() {
  return (
    <View>
      {Array.from({ length: 3 }).map((_, i) => (
        <View key={i} style={{ padding: SP['4'], gap: SP['3'] }}>
          <Skeleton width={120} height={20} />
          <Skeleton width="100%" height={360} />
          <Skeleton width={200} height={16} />
        </View>
      ))}
    </View>
  );
}
