import { View, Text, ScrollView, RefreshControl, Image } from 'react-native';
import { useEffect, useCallback, useMemo } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { C, R, SP, SHADOW } from '../../../design/tokens';
import { T } from '../../../design/typography';
import { TABBAR } from '../../../design/tabbar';
import { Icon } from '../../../constants/icons';
import { PressableScale } from '../../../components/ui/PressableScale';
import { EmptyState } from '../../../components/ui/EmptyState';
import { OfficialBadge } from '../../../components/community/OfficialBadge';
import { AnonPostCard } from '../../../components/feed/AnonPostCard';
import {
  fetchMyCommunities,
  fetchMyCommunityPostsRich,
  subscribeToMyCommunityChanges,
  type CommunityMetaLite,
} from '../../../lib/api/communities';
import { useAuthStore } from '../../../stores/authStore';
import { useLike, useLikes } from '../../../hooks/useLike';
import { useConcern, useConcerns } from '../../../hooks/useConcern';
import { useSave, useSaves } from '../../../hooks/useSave';
import { useShare } from '../../../hooks/useShare';
import { useReactions, useReactionToggle } from '../../../hooks/useReactions';
import { useAddedTags, useAddTag } from '../../../hooks/useAddedTags';
import { usePolls } from '../../../hooks/usePolls';
import { useToastStore } from '../../../stores/toastStore';
import type { Post } from '../../../types/models';

export default function CommunityScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const { show: showToast } = useToastStore();

  // 参加コミュ一覧 (横スクロール用) — React Query
  const myCommunitiesQuery = useQuery({
    queryKey: ['my-communities', user?.id],
    queryFn: fetchMyCommunities,
    enabled: !!user,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });

  // 所属コミュ最新投稿 (AnonPostCard 互換の Post[] + community メタ)
  // 監査指摘: 旧版はシンプルな body/image_url カードで表示し、いいね/コメ
  // ント/保存/リアクション等の操作ができなかった。コミュ詳細画面の FeedTab
  // と同じ AnonPostCard で描画して、機能完全な投稿カードを出す。
  const feedQuery = useQuery({
    queryKey: ['my-community-feed-rich', user?.id],
    queryFn: () => fetchMyCommunityPostsRich(40),
    enabled: !!user,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });

  const myCommunities = myCommunitiesQuery.data ?? [];
  const posts: Post[] = feedQuery.data?.posts ?? [];
  const communityByPost: Record<string, CommunityMetaLite> =
    feedQuery.data?.communityByPost ?? {};
  const loading = myCommunitiesQuery.isLoading || feedQuery.isLoading;
  const refreshing = myCommunitiesQuery.isFetching && !myCommunitiesQuery.isLoading;

  // realtime: 別画面で join/leave 時に即時反映
  useEffect(() => {
    if (!user?.id) return;
    const sub = subscribeToMyCommunityChanges(user.id, () => {
      qc.invalidateQueries({ queryKey: ['my-communities', user.id] });
      qc.invalidateQueries({ queryKey: ['my-community-feed-rich', user.id] });
    });
    return () => sub.unsubscribe();
  }, [user?.id, qc]);

  // タブ復帰時に refetch
  useFocusEffect(
    useCallback(() => {
      if (!user?.id) return;
      void qc.invalidateQueries({ queryKey: ['my-communities', user.id] });
      void qc.invalidateQueries({ queryKey: ['my-community-feed-rich', user.id] });
    }, [user?.id, qc]),
  );

  const onRefresh = useCallback(async () => {
    if (!user?.id) return;
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['my-communities', user.id] }),
      qc.invalidateQueries({ queryKey: ['my-community-feed-rich', user.id] }),
    ]);
  }, [user?.id, qc]);

  // ----- AnonPostCard 用の hooks (FeedTab と同じパターン) -----
  const postIds = useMemo(() => posts.map((p) => p.id), [posts]);
  const { toggle: toggleLike } = useLike();
  const { toggle: toggleConcern } = useConcern();
  const { toggle: toggleSave } = useSave();
  const { toggle: toggleReact } = useReactionToggle();
  const { share } = useShare();
  const { addTag } = useAddTag();
  const { data: myLikes = {} } = useLikes(postIds);
  const { data: myConcerns = {} } = useConcerns(postIds);
  const { data: mySaves = {} } = useSaves(postIds);
  const { data: reactionsByPost = {} } = useReactions(postIds);
  const { data: addedTagsByPost = {} } = useAddedTags(postIds);
  const { polls } = usePolls(postIds);

  const handleAddTag = useCallback(
    async (postId: string, tag: string) => {
      try {
        await addTag(postId, tag);
        showToast(`#${tag} を追加しました`, 'success');
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : '';
        if (msg.includes('duplicate')) showToast('そのタグは既に追加されています', 'warn');
        else showToast('追加に失敗しました', 'error');
      }
    },
    [addTag, showToast],
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* 上部ヘッダ */}
      <View
        style={{
          paddingTop: insets.top + SP['2'],
          paddingHorizontal: SP['4'],
          paddingBottom: SP['2'],
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['3'],
          backgroundColor: C.bg,
          borderBottomWidth: 1,
          borderBottomColor: C.border,
        }}
      >
        <Text style={[T.h2, { flex: 1, color: C.text, letterSpacing: -0.5 }]}>コミュニティ</Text>
        <PressableScale
          onPress={() => router.push('/community/discover' as never)}
          haptic="tap"
          style={{ padding: SP['2'] }}
          accessibilityLabel="コミュニティを検索"
        >
          <Icon.search size={22} color={C.text} strokeWidth={2.2} />
        </PressableScale>
        <PressableScale
          onPress={() => router.push('/community/create' as never)}
          haptic="confirm"
          style={{
            paddingHorizontal: SP['3'],
            paddingVertical: SP['2'],
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            backgroundColor: C.accent,
            borderRadius: R.full,
            ...SHADOW.accentGlow,
          }}
        >
          <Icon.plus size={16} color="#fff" strokeWidth={2.6} />
          <Text style={[T.smallM, { color: '#fff', fontWeight: '700' }]}>作成</Text>
        </PressableScale>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingBottom: insets.bottom + TABBAR.height + SP['6'],
        }}
        refreshControl={
          <RefreshControl tintColor={C.text2} refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* 横スクロール: 自分の所属コミュニティ */}
        <View style={{ paddingTop: SP['4'], paddingBottom: SP['3'] }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: SP['4'],
              marginBottom: SP['2'],
            }}
          >
            <Text style={[T.smallB, { color: C.text2, letterSpacing: 0.4, fontWeight: '700' }]}>
              参加中
              {myCommunities.length > 0 && (
                <Text style={[T.smallB, { color: C.text3 }]}>  {myCommunities.length}</Text>
              )}
            </Text>
            {myCommunities.length > 4 && (
              <Text style={[T.caption, { color: C.text3 }]}>← スワイプで全部見る</Text>
            )}
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: SP['4'], gap: SP['3'] }}
          >
            {myCommunities.length === 0 && !loading ? (
              <View
                style={{
                  paddingVertical: SP['3'],
                  paddingHorizontal: SP['4'],
                  backgroundColor: C.bg2,
                  borderRadius: R.md,
                  borderWidth: 1,
                  borderColor: C.border,
                  borderStyle: 'dashed',
                }}
              >
                <Text style={[T.small, { color: C.text3 }]}>
                  まだコミュニティに参加していません
                </Text>
              </View>
            ) : (
              myCommunities.map((c) => (
                <PressableScale
                  key={c.id}
                  onPress={() => router.push(`/community/${c.id}` as never)}
                  haptic="tap"
                  style={{ alignItems: 'center', width: 70 }}
                >
                  <View style={{ position: 'relative' }}>
                    <View
                      style={{
                        width: 56,
                        height: 56,
                        borderRadius: 28,
                        backgroundColor: c.icon_url ? C.bg3 : c.icon_color,
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderWidth: c.is_official ? 2 : 1,
                        borderColor: c.is_official ? C.accent : C.border,
                        overflow: 'hidden',
                      }}
                    >
                      {c.icon_url ? (
                        <Image source={{ uri: c.icon_url }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                      ) : (
                        <Text style={{ fontSize: 28 }}>{c.icon_emoji}</Text>
                      )}
                    </View>
                    {c.is_official && (
                      <View
                        style={{
                          position: 'absolute',
                          right: -2,
                          bottom: -2,
                          borderWidth: 2,
                          borderColor: C.bg,
                          borderRadius: R.full,
                        }}
                      >
                        <OfficialBadge size="sm" iconOnly />
                      </View>
                    )}
                  </View>
                  <Text
                    numberOfLines={1}
                    style={[T.caption, { color: C.text2, marginTop: 4, textAlign: 'center' }]}
                  >
                    {c.name}
                  </Text>
                </PressableScale>
              ))
            )}

            {/* 末尾に「探す」ボタン */}
            <PressableScale
              onPress={() => router.push('/community/discover' as never)}
              haptic="tap"
              style={{ alignItems: 'center', width: 70 }}
            >
              <View
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 28,
                  backgroundColor: C.bg3,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1,
                  borderColor: C.border,
                  borderStyle: 'dashed',
                }}
              >
                <Icon.search size={22} color={C.text3} strokeWidth={2.2} />
              </View>
              <Text
                numberOfLines={1}
                style={[T.caption, { color: C.text3, marginTop: 4, textAlign: 'center' }]}
              >
                探す
              </Text>
            </PressableScale>
          </ScrollView>
        </View>

        {/* 区切り */}
        <View style={{ height: 1, backgroundColor: C.divider, marginHorizontal: SP['4'] }} />

        {/* 最新投稿フィード — AnonPostCard でフル機能表示 */}
        <View style={{ paddingTop: SP['2'] }}>
          {posts.length === 0 ? (
            <View style={{ paddingTop: SP['10'], paddingHorizontal: SP['4'] }}>
              <EmptyState
                icon={Icon.community}
                title={myCommunities.length === 0 ? 'コミュニティに参加しよう' : 'まだ投稿がありません'}
                message={
                  myCommunities.length === 0
                    ? '好きなテーマで集まれる場所。検索して参加するか、自分で作ろう。'
                    : '所属コミュニティの新着投稿がここに表示されます。'
                }
              />
              {myCommunities.length === 0 && (
                <View style={{ gap: SP['2'], marginTop: SP['4'] }}>
                  <PressableScale
                    onPress={() => router.push('/community/discover' as never)}
                    haptic="confirm"
                    style={{
                      paddingVertical: SP['3'],
                      backgroundColor: C.accent,
                      borderRadius: R.md,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={[T.bodyMd, { color: '#fff', fontWeight: '700' }]}>
                      コミュニティを探す
                    </Text>
                  </PressableScale>
                  <PressableScale
                    onPress={() => router.push('/community/create' as never)}
                    haptic="tap"
                    style={{
                      paddingVertical: SP['3'],
                      backgroundColor: C.bg3,
                      borderRadius: R.md,
                      alignItems: 'center',
                      borderWidth: 1,
                      borderColor: C.border,
                    }}
                  >
                    <Text style={[T.bodyMd, { color: C.text, fontWeight: '600' }]}>
                      新しく作る
                    </Text>
                  </PressableScale>
                </View>
              )}
            </View>
          ) : (
            posts.map((p) => {
              const community = communityByPost[p.id];
              return (
                <View key={`${community?.id ?? 'no-community'}:${p.id}`}>
                  {/* どのコミュ経由か分かるよう、カード上にミニピル表示 */}
                  {community && (
                    <PressableScale
                      onPress={() => router.push(`/community/${community.id}` as never)}
                      haptic="tap"
                      hitSlop={6}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                        marginHorizontal: SP['4'],
                        marginTop: SP['3'],
                        marginBottom: -SP['1'],
                        paddingHorizontal: SP['2'],
                        paddingVertical: 4,
                        backgroundColor: community.is_official ? C.accentBg : C.bg3,
                        borderRadius: R.full,
                        alignSelf: 'flex-start',
                        borderWidth: 1,
                        borderColor: community.is_official ? C.accent : C.border,
                      }}
                    >
                      {community.icon_url ? (
                        <Image
                          source={{ uri: community.icon_url }}
                          style={{ width: 14, height: 14, borderRadius: 7 }}
                          resizeMode="cover"
                        />
                      ) : (
                        <Text style={{ fontSize: 11 }}>{community.icon_emoji}</Text>
                      )}
                      <Text style={[T.caption, {
                        color: community.is_official ? C.accent : C.text2,
                        fontWeight: '700',
                        fontSize: 10,
                      }]}>
                        {community.name}
                      </Text>
                      {community.is_official && (
                        <View style={{
                          width: 12, height: 12, borderRadius: 6,
                          backgroundColor: C.accent,
                          alignItems: 'center', justifyContent: 'center',
                        }}>
                          <Icon.check size={8} color="#fff" strokeWidth={3} />
                        </View>
                      )}
                    </PressableScale>
                  )}
                  <AnonPostCard
                    post={p}
                    liked={!!myLikes[p.id]}
                    concerned={!!myConcerns[p.id]}
                    saved={!!mySaves[p.id]}
                    reactions={reactionsByPost[p.id] ?? []}
                    addedTags={addedTagsByPost[p.id] ?? []}
                    poll={polls[p.id]}
                    onLike={() => toggleLike(p.id)}
                    onConcern={() => toggleConcern(p.id, !!myConcerns[p.id])}
                    onComment={() => router.push(`/post/${p.id}` as never)}
                    onSave={() => toggleSave(p.id)}
                    onShare={() => share(`Geek の投稿 #${p.tag_names[0] ?? '雑談'}`, `/post/${p.id}`)}
                    onTagPress={(name) => router.push(`/tag/${encodeURIComponent(name)}` as never)}
                    onMore={() => { /* report flow: 別途実装 */ }}
                    onReact={(meme) => toggleReact(p.id, meme)}
                    onAddTag={(tag) => { void handleAddTag(p.id, tag); }}
                  />
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </View>
  );
}
