import { View, Text, RefreshControl } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useInfiniteQuery } from '@tanstack/react-query';
import { FlashList } from '@shopify/flash-list';
import { fetchPosts } from '@/lib/api/posts';
import { useLike } from '@/hooks/useLike';
import { useSave } from '@/hooks/useSave';
import { useShare } from '@/hooks/useShare';
import { useTagFilterStore } from '@/stores/tagFilterStore';
import { useToastStore } from '@/stores/toastStore';
import { C, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import { PressableScale } from '@/components/ui/PressableScale';
import { Spinner } from '@/components/ui/Spinner';
import { AnonPostCard } from '@/components/feed/AnonPostCard';
import { Icon } from '@/constants/icons';
import type { Post } from '@/types/models';
import * as Haptics from 'expo-haptics';

export default function TagDetailScreen() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { likedTags, blockedTags, addLiked, removeLiked, addBlocked, removeBlocked } = useTagFilterStore();
  const { show } = useToastStore();
  const { toggle: like } = useLike();
  const { toggle: save } = useSave();
  const { share } = useShare();
  const BackIcon = Icon.arrowL;
  const HeartIcon = Icon.heart;
  const BlockIcon = Icon.block;

  const isLiked = likedTags.includes(name);
  const isBlocked = blockedTags.includes(name);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isLoading,
    isRefetching,
    refetch,
  } = useInfiniteQuery({
    queryKey: ['tag-feed', name],
    queryFn: ({ pageParam }) => fetchPosts({ cursor: pageParam as string | undefined, likedTags: [], blockedTags: [], filterTags: [name] }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 30_000,
  });

  const posts = data?.pages.flatMap((p) => p.posts) ?? [];

  const handleLikeTag = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (isLiked) {
      removeLiked(name);
      show(`「${name}」のお気に入りを解除しました`, 'success');
    } else {
      addLiked(name);
      show(`「${name}」をお気に入りに追加しました`, 'success');
    }
  };

  const handleBlockTag = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (isBlocked) {
      removeBlocked(name);
      show(`「${name}」のブロックを解除しました`, 'success');
    } else {
      addBlocked(name);
      show(`「${name}」をブロックしました`, 'success', { undoLabel: 'undo', onUndo: () => removeBlocked(name) });
    }
  };

  const renderPost = ({ item }: { item: Post }) => (
    <AnonPostCard
      post={item}
      onLike={() => like(item.id)}
      onComment={() => router.push(`/post/${item.id}`)}
      onSave={() => save(item.id)}
      onShare={() => share(`Geek - ${name}`, `geek://post/${item.id}`)}
      onTagPress={(t) => router.push(`/tag/${t}`)}
      onMore={() => {}}
    />
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* ヘッダー */}
      <View
        style={{
          paddingTop: insets.top + SP['2'],
          paddingBottom: SP['3'],
          paddingHorizontal: SP['4'],
          borderBottomWidth: 1,
          borderBottomColor: C.border,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: SP['3'] }}>
          <PressableScale onPress={() => router.back()} haptic="tap" style={{ padding: SP['2'] }}>
            <BackIcon size={24} color={C.text} strokeWidth={2.2} />
          </PressableScale>
          <Text style={[T.h3, { color: C.text, marginLeft: SP['3'], flex: 1 }]}>#{name}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: SP['3'] }}>
          <PressableScale
            onPress={handleLikeTag}
            haptic="select"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: SP['2'],
              paddingHorizontal: SP['4'],
              paddingVertical: SP['2'],
              borderRadius: 999,
              backgroundColor: isLiked ? C.accentSoft : C.bg3,
            }}
          >
            <HeartIcon size={16} color={isLiked ? C.accent : C.text3} strokeWidth={2.2} />
            <Text style={[T.smallM, { color: isLiked ? C.accent : C.text3 }]}>
              {isLiked ? 'お気に入り済み' : 'お気に入り'}
            </Text>
          </PressableScale>
          <PressableScale
            onPress={handleBlockTag}
            haptic="select"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: SP['2'],
              paddingHorizontal: SP['4'],
              paddingVertical: SP['2'],
              borderRadius: 999,
              backgroundColor: isBlocked ? C.blockBg : C.bg3,
            }}
          >
            <BlockIcon size={16} color={isBlocked ? C.block : C.text3} strokeWidth={2.2} />
            <Text style={[T.smallM, { color: isBlocked ? C.block : C.text3 }]}>
              {isBlocked ? 'ブロック中' : 'ブロック'}
            </Text>
          </PressableScale>
        </View>
      </View>

      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Spinner />
        </View>
      ) : (
        <FlashList
          data={posts}
          keyExtractor={(item) => item.id}
          renderItem={renderPost}
          estimatedItemSize={600}
          onEndReached={() => hasNextPage && fetchNextPage()}
          onEndReachedThreshold={0.5}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={C.accent} />
          }
          ListEmptyComponent={
            <View style={{ padding: SP['12'], alignItems: 'center' }}>
              <Text style={[T.body, { color: C.text3 }]}>まだ投稿がありません</Text>
            </View>
          }
        />
      )}
    </View>
  );
}
