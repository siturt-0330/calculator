import { useMemo } from 'react';
import { View, Text, RefreshControl } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { FlashList } from '@shopify/flash-list';
import { LinearGradient } from 'expo-linear-gradient';
import { fetchPosts } from '../../lib/api/posts';
import { getTagCommunity } from '../../lib/api/subscriptions';
import { useLike, useLikes } from '../../hooks/useLike';
import { useConcern, useConcerns } from '../../hooks/useConcern';
import { useSave } from '../../hooks/useSave';
import { useShare } from '../../hooks/useShare';
import { useReactions, useReactionToggle } from '../../hooks/useReactions';
import { useAddedTags, useAddTag } from '../../hooks/useAddedTags';
import { useSearchSignalsStore } from '../../stores/searchSignalsStore';
import { useSearchClickStore } from '../../stores/searchClickStore';
import { smartSort } from '../../lib/feed/smartRank';
import { useTagFilterStore } from '../../stores/tagFilterStore';
import { useToastStore } from '../../stores/toastStore';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { PressableScale } from '../../components/ui/PressableScale';
import { Spinner } from '../../components/ui/Spinner';
import { AnonPostCard } from '../../components/feed/AnonPostCard';
import { TagRelations } from '../../components/tag/TagRelations';
import { EmptyState } from '../../components/ui/EmptyState';
import { Icon } from '../../constants/icons';
import type { Post } from '../../types/models';
import { impact, Haptics } from '../../lib/haptics';

export default function TagDetailScreen() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { blockedTags, addBlocked, removeBlocked } = useTagFilterStore();
  const { show } = useToastStore();
  const { toggle: like } = useLike();
  const { toggle: concern } = useConcern();
  const { toggle: save } = useSave();
  const { toggle: react } = useReactionToggle();
  const { share } = useShare();
  const BackIcon = Icon.arrowL;
  const BlockIcon = Icon.block;
  const Users = Icon.friends;

  const isBlocked = blockedTags.includes(name);

  const { data: community } = useQuery({
    queryKey: ['tag-community', name],
    queryFn: () => getTagCommunity(name),
    staleTime: 60_000,
  });

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isLoading,
    isRefetching,
    refetch,
  } = useInfiniteQuery({
    queryKey: ['tag-feed', name],
    queryFn: ({ pageParam }) =>
      fetchPosts({
        cursor: pageParam as string | undefined,
        likedTags: [],
        blockedTags: [],
        filterTags: [name],
        sort: 'hot',
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 30_000,
  });

  const rawPostsT: Post[] = data?.pages.flatMap((p) => p.posts) ?? [];
  // V4 smart-rank: タグページの投稿も個人化スコアで並べ替え
  const aggregateT = useSearchSignalsStore((s) => s.aggregate);
  const signalsT = useMemo(() => aggregateT(), [aggregateT]);
  const queryToTagCountT = useSearchClickStore((s) => s.queryToTagCount);
  const ctrBoostsT = useMemo(() => {
    const m: Record<string, number> = {};
    for (const tagMap of Object.values(queryToTagCountT)) {
      for (const [tag, count] of Object.entries(tagMap)) m[tag] = (m[tag] ?? 0) + count;
    }
    return m;
  }, [queryToTagCountT]);
  const posts: Post[] = useMemo(() => {
    if (rawPostsT.length === 0) return rawPostsT;
    return smartSort(rawPostsT, {
      likedTags: new Set(useTagFilterStore.getState().likedTags),
      blockedTags: new Set(blockedTags),
      tagAffinity: signalsT.tagFreq,
      recentTags: signalsT.recentTags,
      recentQueries: [],
      ctrBoosts: ctrBoostsT,
    });
  }, [rawPostsT, blockedTags, signalsT.tagFreq, signalsT.recentTags, ctrBoostsT]);
  // postIds は中身が同じ render で同じ参照を保つ (hash で安定化)
  const postIdsHash = posts.map((p) => p.id).join('|');
  const postIds = useMemo(() => posts.map((p) => p.id), [postIdsHash]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data: myLikes = {} } = useLikes(postIds);
  const { data: myConcerns = {} } = useConcerns(postIds);
  const { data: reactionsByPost } = useReactions(postIds);
  const { data: addedTagsByPost } = useAddedTags(postIds);
  const { addTag } = useAddTag();

  const handleAddTag = async (postId: string, tag: string) => {
    try {
      await addTag(postId, tag);
      show(`#${tag} を追加しました`, 'success');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('duplicate')) show('そのタグは既に追加されています', 'warn');
      else show('追加に失敗しました', 'error');
    }
  };

  const handleBlockTag = () => {
    impact(Haptics.ImpactFeedbackStyle.Medium);
    if (isBlocked) {
      removeBlocked(name);
      show(`「${name}」のブロックを解除しました`, 'success');
    } else {
      addBlocked(name);
      show(`「${name}」をブロックしました`, 'success', { undoLabel: '元に戻す', onUndo: () => removeBlocked(name) });
    }
  };

  const renderPost = ({ item }: { item: Post }) => (
    <AnonPostCard
      post={item}
      liked={!!myLikes[item.id]}
      concerned={!!myConcerns[item.id]}
      reactions={reactionsByPost[item.id] ?? []}
      addedTags={addedTagsByPost[item.id] ?? []}
      onLike={() => like(item.id)}
      onConcern={() => concern(item.id, !!myConcerns[item.id])}
      onComment={() => router.push(`/post/${item.id}` as never)}
      onSave={() => save(item.id)}
      onShare={() => share(`Geek の投稿 #${name}`, `/post/${item.id}`)}
      onTagPress={(t) => router.push(`/tag/${encodeURIComponent(t)}` as never)}
      onMore={() => {}}
      onReact={(meme) => react(item.id, meme)}
      onAddTag={(tag) => handleAddTag(item.id, tag)}
    />
  );

  const bannerColor = community?.banner_color ?? C.accent;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* コミュニティバナー */}
      <LinearGradient
        colors={[bannerColor + 'CC', C.bg]}
        style={{
          paddingTop: insets.top + SP['2'],
          paddingHorizontal: SP['4'],
          paddingBottom: SP['4'],
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: SP['3'] }}>
          <PressableScale onPress={() => router.back()} haptic="tap" style={{ padding: SP['2'] }}>
            <BackIcon size={24} color="#fff" strokeWidth={2.2} />
          </PressableScale>
          <View style={{ flex: 1 }} />
          <PressableScale onPress={handleBlockTag} haptic="select" style={{
            flexDirection: 'row', alignItems: 'center', gap: 4,
            paddingHorizontal: SP['3'], paddingVertical: SP['1'],
            borderRadius: R.full,
            backgroundColor: isBlocked ? 'rgba(255,107,122,0.18)' : 'rgba(0,0,0,0.25)',
            borderWidth: 1, borderColor: isBlocked ? '#FF6B7A' : 'rgba(255,255,255,0.2)',
          }}>
            <BlockIcon size={14} color={isBlocked ? '#FF6B7A' : '#ffffffcc'} strokeWidth={2.2} />
            <Text style={{ fontSize: 11, color: isBlocked ? '#FF6B7A' : '#ffffffcc', fontWeight: '700' }}>
              {isBlocked ? 'ブロック中' : 'ブロック'}
            </Text>
          </PressableScale>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['3'] }}>
          <View style={{
            width: 64,
            height: 64,
            borderRadius: 32,
            backgroundColor: bannerColor,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 3,
            borderColor: C.bg,
          }}>
            <Text style={{ fontSize: 28, color: '#fff', fontWeight: '700' }}>#</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[T.h1, { color: C.text }]}>{name}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'], marginTop: 2 }}>
              <Users size={14} color={C.text2} strokeWidth={2.2} />
              <Text style={[T.small, { color: C.text2 }]}>
                {(community?.post_count ?? 0).toLocaleString()} 投稿
              </Text>
            </View>
          </View>
        </View>

        {community?.description && (
          <Text style={[T.small, { color: C.text2, marginTop: SP['3'] }]}>
            {community.description}
          </Text>
        )}
      </LinearGradient>

      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Spinner />
        </View>
      ) : (
        <FlashList
          data={posts}
          keyExtractor={(item) => item.id}
          renderItem={renderPost}
          estimatedItemSize={300}
          onEndReached={() => hasNextPage && fetchNextPage()}
          onEndReachedThreshold={0.5}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={C.accent} />
          }
          ListHeaderComponent={
            <View style={{ padding: SP['3'] }}>
              <TagRelations
                tagName={name}
                onTagPress={(t) => router.push(`/tag/${encodeURIComponent(t)}` as never)}
              />
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              icon={Icon.sparkles}
              title="まだ投稿がありません"
              message={`#${name} に最初の投稿をしてみよう`}
              actionLabel="投稿する"
              onAction={() => router.push(`/post/create?prefill_tag=${encodeURIComponent(name)}` as never)}
            />
          }
        />
      )}

      {/* 既存投稿がある場合の FAB — このタグで投稿 */}
      {!isLoading && posts.length > 0 && (
        <PressableScale
          onPress={() => router.push(`/post/create?prefill_tag=${encodeURIComponent(name)}` as never)}
          haptic="confirm"
          accessibilityLabel={`#${name} に投稿する`}
          accessibilityRole="button"
          style={{
            position: 'absolute',
            right: SP['4'],
            bottom: insets.bottom + SP['4'],
            width: 56, height: 56,
            borderRadius: 28,
            backgroundColor: C.accent,
            alignItems: 'center', justifyContent: 'center',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.3,
            shadowRadius: 12,
            elevation: 6,
          }}
        >
          <Icon.plus size={26} color="#fff" strokeWidth={2.6} />
        </PressableScale>
      )}
    </View>
  );
}
