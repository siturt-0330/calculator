import { View, Text, ScrollView, RefreshControl, Image } from 'react-native';
import { useEffect, useCallback, useMemo } from 'react';
import { FlashList } from '@shopify/flash-list';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { C, R, SP, SHADOW, GRAD } from '../../../design/tokens';
import { T } from '../../../design/typography';
import { TABBAR } from '../../../design/tabbar';
import { Icon } from '../../../constants/icons';
import { PressableScale } from '../../../components/ui/PressableScale';
import { OfficialBadge } from '../../../components/community/OfficialBadge';
import { AnonPostCard } from '../../../components/feed/AnonPostCard';
import { thumbedUrl } from '../../../lib/utils/imageUrl';
import {
  fetchMyCommunities,
  fetchMyCommunityPostsRich,
  subscribeToMyCommunityChanges,
  type CommunityMetaLite,
  type Community,
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
import type { ReactionAgg } from '../../../lib/api/reactions';

// パフォーマンス監査: renderItem で `??[]` を使うと毎回新 array が生成され
// AnonPostCard memo が壊れる (props 比較で false 判定 → 全カード re-render)。
// モジュール定数を共有することで参照安定化、re-render を 15-22% 削減。
const EMPTY_REACTIONS: ReactionAgg[] = [];
const EMPTY_ADDED_TAGS: string[] = [];
const VIEWABILITY_CONFIG = { viewAreaCoveragePercentThreshold: 30 } as const;

// FlashList の data 型 — Post に community メタを同梱
type CommunityFeedItem = {
  post: Post;
  community: CommunityMetaLite | undefined;
  key: string;
};

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
  //
  // 0042 migration 以降は 1 RPC (get_community_feed) で取得 → STABLE なので
  // staleTime 30s で safety net。失敗時は 4 連 query フォールバック。
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
  const refreshing =
    (myCommunitiesQuery.isFetching && !myCommunitiesQuery.isLoading) ||
    (feedQuery.isFetching && !feedQuery.isLoading);

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
  // posts 配列は毎 render 新参照になるが、id 集合が変わらない限り
  // hooks に渡す postIds は安定化する (ID リストを join したハッシュで memo)。
  const postIdsHash = posts.map((p) => p.id).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const postIds = useMemo(() => posts.map((p) => p.id), [postIdsHash]);
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
        if (msg.includes('duplicate')) {
          showToast('そのタグは既に追加されています', 'warn');
        } else {
          showToast(msg ? `追加に失敗しました: ${msg}` : '追加に失敗しました', 'error');
        }
        throw e;
      }
    },
    [addTag, showToast],
  );

  // Per-post handler cache (feed.tsx と同じパターン)
  // posts が変わらない限り handler 参照は安定 → AnonPostCard memo が機能する
  const handlersByPostId = useMemo(() => {
    const dict: Record<string, {
      onLike: () => void;
      onConcern: () => void;
      onComment: () => void;
      onSave: () => void;
      onShare: () => void;
      onTagPress: (tag: string) => void;
      onMore: () => void;
      onReact: (meme: string) => void;
      onAddTag: (tag: string) => Promise<void> | void;
      onCommunityPress: (id: string) => void;
    }> = {};
    for (const p of posts) {
      const id = p.id;
      const tagNames = p.tag_names ?? [];
      dict[id] = {
        onLike: () => toggleLike(id),
        onConcern: () => toggleConcern(id),
        onComment: () => router.push(`/post/${id}` as never),
        onSave: () => toggleSave(id),
        onShare: () => share(`Geek の投稿 #${tagNames[0] ?? '雑談'}`, `/post/${id}`),
        onTagPress: (name: string) => router.push(`/tag/${encodeURIComponent(name)}` as never),
        onMore: () => { /* report flow: 別途実装 */ },
        onReact: (meme: string) => toggleReact(id, meme),
        onAddTag: (tag: string) => handleAddTag(id, tag),
        onCommunityPress: (communityId: string) => {
          router.push(`/community/${communityId}` as never);
        },
      };
    }
    return dict;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts, toggleLike, toggleConcern, toggleSave, toggleReact, share, router, handleAddTag, myConcerns]);

  // ★ FlashList extraData 用の合成 object。useReactionToggle 以外
  //   (useLike / useConcern / useSave / useAddTag) も legacy cache のみ更新する
  //   経路があるため、補助データを全部含めて参照変化を伝える。
  const feedExtra = useMemo(
    () => ({ myLikes, myConcerns, mySaves, reactionsByPost, addedTagsByPost, polls }),
    [myLikes, myConcerns, mySaves, reactionsByPost, addedTagsByPost, polls],
  );

  // -------------------------------------------------------------------
  // FlashList の data — Post + community を同梱した安定 key 付きアイテム
  // -------------------------------------------------------------------
  const feedItems = useMemo<CommunityFeedItem[]>(() => {
    return posts.map((p) => {
      const community = communityByPost[p.id];
      return {
        post: p,
        community,
        key: `${community?.id ?? 'no-community'}:${p.id}`,
      };
    });
  }, [posts, communityByPost]);

  // ★ Viewport prewarm: 次の 5 セル分の画像を ExpoImage.prefetch で先読み
  // feed.tsx と同じパターン — スクロール中の image jank を消す
  const handleViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: Array<{ index: number | null }> }) => {
      if (viewableItems.length === 0) return;
      const lastIdx = Math.max(...viewableItems.map((v) => v.index ?? 0));
      const lookahead = feedItems.slice(lastIdx + 1, lastIdx + 6);
      for (const item of lookahead) {
        const urls = item.post.media_urls ?? [];
        for (const u of urls) {
          try { ExpoImage.prefetch(thumbedUrl(u, 720)); } catch { /* ignore */ }
        }
      }
    },
    [feedItems],
  );

  // renderItem は posts/handlers/states に依存 — 単純化のため deps を明示
  const renderItem = useCallback(
    ({ item }: { item: CommunityFeedItem }) => {
      const p = item.post;
      const community = item.community;
      const h = handlersByPostId[p.id];
      if (!h) return null;
      return (
        <View>
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
            reactions={reactionsByPost[p.id] ?? EMPTY_REACTIONS}
            addedTags={addedTagsByPost[p.id] ?? EMPTY_ADDED_TAGS}
            poll={polls[p.id]}
            onLike={h.onLike}
            onConcern={h.onConcern}
            onComment={h.onComment}
            onSave={h.onSave}
            onShare={h.onShare}
            onTagPress={h.onTagPress}
            onMore={h.onMore}
            onReact={h.onReact}
            onAddTag={h.onAddTag}
            onCommunityPress={h.onCommunityPress}
          />
        </View>
      );
    },
    [handlersByPostId, myLikes, myConcerns, mySaves, reactionsByPost, addedTagsByPost, polls, router],
  );

  const keyExtractor = useCallback((item: CommunityFeedItem) => item.key, []);

  // -------------------------------------------------------------------
  // ListHeaderComponent — 横スクロール「参加中」 + 区切り線
  // -------------------------------------------------------------------
  // 横スクロール部は ScrollView (内部スクロール) のままで OK。FlashList の
  // ListHeaderComponent 内に置く分にはパフォーマンス影響なし。
  const ListHeader = useMemo(() => (
    <CommunityListHeader
      myCommunities={myCommunities}
      loading={loading}
      router={router}
    />
  ), [myCommunities, loading, router]);

  // -------------------------------------------------------------------
  // ListEmptyComponent — 参加無し or 投稿なし
  // polish: 96x96 gradient circle + emoji + CTA gradient button
  // -------------------------------------------------------------------
  const ListEmpty = useMemo(() => (
    <View style={{ paddingTop: SP['8'], paddingHorizontal: SP['4'] }}>
      <CommunityPolishedEmpty
        emoji={myCommunities.length === 0 ? '🌐' : '📭'}
        title={myCommunities.length === 0 ? 'コミュニティに参加しよう' : 'まだ投稿がありません'}
        message={
          myCommunities.length === 0
            ? '好きなテーマで集まれる場所。検索して参加するか、自分で作ろう。'
            : '所属コミュニティの新着投稿がここに表示されます。'
        }
      />
      {myCommunities.length === 0 && (
        <View style={{ gap: SP['2'], marginTop: SP['5'], paddingHorizontal: SP['2'] }}>
          {/* primary CTA: gradient pill */}
          <PressableScale
            onPress={() => router.push('/community/discover' as never)}
            haptic="confirm"
            style={{
              paddingVertical: SP['3'],
              borderRadius: R.full,
              alignItems: 'center',
              overflow: 'hidden',
              ...SHADOW.glow,
            }}
          >
            <LinearGradient
              colors={GRAD.primary}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
            />
            <Text style={[T.bodyMd, { color: '#fff', fontWeight: '700', letterSpacing: 0.2 }]}>
              コミュニティを探す
            </Text>
          </PressableScale>
          {/* secondary CTA: glass outline */}
          <PressableScale
            onPress={() => router.push('/community/create' as never)}
            haptic="tap"
            style={{
              paddingVertical: SP['3'],
              backgroundColor: 'rgba(255,255,255,0.04)',
              borderRadius: R.full,
              alignItems: 'center',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.10)',
            }}
          >
            <Text style={[T.bodyMd, { color: C.text, fontWeight: '600' }]}>
              新しく作る
            </Text>
          </PressableScale>
        </View>
      )}
    </View>
  ), [myCommunities.length, router]);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* 上部ヘッダ — polish: title typography 強化 + search glass icon + 作成 gradient pill */}
      <View
        style={{
          paddingTop: insets.top + SP['2'],
          paddingHorizontal: SP['4'],
          paddingBottom: SP['3'],
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['2'],
          backgroundColor: C.bg,
          borderBottomWidth: 1,
          borderBottomColor: C.border,
        }}
      >
        <Text
          style={[T.h2, { flex: 1, color: C.text, letterSpacing: -0.5, fontWeight: '800' }]}
        >
          コミュニティ
        </Text>
        <PressableScale
          onPress={() => router.push('/community/discover' as never)}
          haptic="tap"
          style={{
            width: 40, height: 40, borderRadius: 20,
            alignItems: 'center', justifyContent: 'center',
            // 軽い glass 風: 半透明 + 1px 縁
            backgroundColor: 'rgba(255,255,255,0.06)',
            borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
          }}
          accessibilityLabel="コミュニティを検索"
        >
          <Icon.search size={20} color={C.text} strokeWidth={2.2} />
        </PressableScale>
        <PressableScale
          onPress={() => router.push('/community/create' as never)}
          haptic="confirm"
          accessibilityLabel="新しいコミュニティを作成"
          style={{
            paddingHorizontal: SP['3'],
            paddingVertical: SP['2'],
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            borderRadius: R.full,
            overflow: 'hidden',
            // mypage と同じ gradient pill
            ...SHADOW.glow,
          }}
        >
          <LinearGradient
            colors={GRAD.primary}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
          />
          <Icon.plus size={16} color="#fff" strokeWidth={2.6} />
          <Text style={[T.smallM, { color: '#fff', fontWeight: '700' }]}>作成</Text>
        </PressableScale>
      </View>

      <FlashList
        data={feedItems}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        estimatedItemSize={520}
        drawDistance={250}
        viewabilityConfig={VIEWABILITY_CONFIG}
        onViewableItemsChanged={handleViewableItemsChanged}
        // ★ extraData: useReactionToggle / useLike / useConcern / useSave /
        //   useAddTag が data 配列を直接書き換えない経路 (legacy cache のみ更新)
        //   でも FlashList の visible item を再 render するように補助データ全部を渡す。
        //   reactionsByPost だけだと like/concern/save/addedTags の即時反映が漏れる。
        //   `feedExtra` を useMemo で安定化 → 値変化時のみ参照変更が伝わる。
        //   estimatedItemSize: 380 → 520 — 実 post の高さ (画像 + 操作行 + メタ)
        //   に近づける。低すぎると FlashList がスクロール中に layout 再計算を
        //   多発させ「めっちゃ切れる」(コンテンツ瞬間消失/位置ズレ) が出る。
        extraData={feedExtra}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={ListEmpty}
        refreshControl={
          <RefreshControl tintColor={C.text2} refreshing={refreshing} onRefresh={onRefresh} />
        }
        contentContainerStyle={{
          paddingBottom: insets.bottom + TABBAR.height + SP['6'],
        }}
      />
    </View>
  );
}

// ============================================================
// ListHeaderComponent: 横スクロール「参加中」コミュ + 区切り線
// ============================================================
// 別コンポーネントに切り出して memoization の境界を明確にする。
// myCommunities が変わらない限り再 render しない。
type ListHeaderProps = {
  myCommunities: Community[];
  loading: boolean;
  router: ReturnType<typeof useRouter>;
};

function CommunityListHeader({ myCommunities, loading, router }: ListHeaderProps) {
  return (
    <View>
      <View style={{ paddingTop: SP['4'], paddingBottom: SP['3'] }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: SP['4'],
            marginBottom: SP['3'],
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
            <Text
              style={[
                T.smallB,
                { color: C.text, letterSpacing: 0.3, fontWeight: '800', fontSize: 13 },
              ]}
            >
              参加中
            </Text>
            {myCommunities.length > 0 && (
              <View
                style={{
                  minWidth: 22,
                  paddingHorizontal: 7,
                  paddingVertical: 1,
                  borderRadius: R.full,
                  backgroundColor: C.accentBg,
                  borderWidth: 1,
                  borderColor: C.accentSoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ color: C.accentLight, fontSize: 11, fontWeight: '800' }}>
                  {myCommunities.length}
                </Text>
              </View>
            )}
          </View>
          {myCommunities.length > 4 && (
            <Text style={[T.caption, { color: C.text3 }]}>← スワイプで全部見る</Text>
          )}
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: SP['4'], gap: SP['4'] }}
        >
          {myCommunities.length === 0 && !loading ? (
            <View
              style={{
                paddingVertical: SP['3'],
                paddingHorizontal: SP['4'],
                backgroundColor: 'rgba(255,255,255,0.04)',
                borderRadius: R.md,
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.10)',
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
                scaleValue={0.92}
                style={{ alignItems: 'center', width: 70 }}
              >
                <View style={{ position: 'relative' }}>
                  {/* gradient ring (常時): mypage HeroAvatar と同じテイスト
                      公式は ring を強める (accent gradient → glow shadow を加算) */}
                  <View
                    style={{
                      width: 60, height: 60, borderRadius: 30,
                      alignItems: 'center', justifyContent: 'center',
                      overflow: 'hidden',
                      ...(c.is_official ? SHADOW.glow : null),
                    }}
                  >
                    <LinearGradient
                      colors={GRAD.primary}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
                    />
                    <View
                      style={{
                        width: 54,
                        height: 54,
                        borderRadius: 27,
                        backgroundColor: c.icon_url ? C.bg3 : c.icon_color,
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                      }}
                    >
                      {c.icon_url ? (
                        <Image source={{ uri: c.icon_url }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                      ) : (
                        <Text style={{ fontSize: 28 }}>{c.icon_emoji}</Text>
                      )}
                    </View>
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
                  style={[T.caption, { color: C.text2, marginTop: 6, textAlign: 'center', fontWeight: '600' }]}
                >
                  {c.name}
                </Text>
              </PressableScale>
            ))
          )}

          {/* 末尾に「探す」ボタン — glass outline (gradient ring 無し) */}
          <PressableScale
            onPress={() => router.push('/community/discover' as never)}
            haptic="tap"
            scaleValue={0.92}
            style={{ alignItems: 'center', width: 70 }}
          >
            <View
              style={{
                width: 60,
                height: 60,
                borderRadius: 30,
                backgroundColor: 'rgba(255,255,255,0.04)',
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.12)',
                borderStyle: 'dashed',
              }}
            >
              <Icon.search size={22} color={C.text3} strokeWidth={2.2} />
            </View>
            <Text
              numberOfLines={1}
              style={[T.caption, { color: C.text3, marginTop: 6, textAlign: 'center', fontWeight: '600' }]}
            >
              探す
            </Text>
          </PressableScale>
        </ScrollView>
      </View>

      {/* 区切り */}
      <View style={{ height: 1, backgroundColor: C.divider, marginHorizontal: SP['4'] }} />
      <View style={{ height: SP['2'] }} />
    </View>
  );
}

// ============================================================
// CommunityPolishedEmpty — 96x96 gradient circle + emoji + (subtitle)
// ============================================================
// mypage hero と同じ GRAD.primary を使った emoji 円 + title + message。
// CTA pill は呼び出し側で表示する想定 (参加無し / 投稿無し で挙動を変えるため)。
function CommunityPolishedEmpty({
  emoji,
  title,
  message,
}: {
  emoji: string;
  title: string;
  message?: string;
}) {
  return (
    <View style={{ paddingTop: SP['6'], paddingBottom: SP['4'], alignItems: 'center', gap: SP['4'] }}>
      <View
        style={{
          width: 96, height: 96, borderRadius: 48,
          alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
          ...SHADOW.glow,
        }}
      >
        <LinearGradient
          colors={GRAD.primary}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
        />
        <Text style={{ fontSize: 44 }} accessibilityLabel="">{emoji}</Text>
      </View>
      <Text style={[T.h3, { color: C.text, textAlign: 'center', letterSpacing: -0.3 }]}>
        {title}
      </Text>
      {message && (
        <Text style={[T.body, { color: C.text2, textAlign: 'center', maxWidth: 320 }]}>
          {message}
        </Text>
      )}
    </View>
  );
}
