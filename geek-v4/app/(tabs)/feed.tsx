import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, RefreshControl } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFeed } from '@/hooks/useFeed';
import { useTagFilter } from '@/hooks/useTagFilter';
import { useTagFilterStore } from '@/stores/tagFilterStore';
import { useLike, useLikes } from '@/hooks/useLike';
import { useConcern, useConcerns } from '@/hooks/useConcern';
import { useSave, useSaves } from '@/hooks/useSave';
import { useShare } from '@/hooks/useShare';
import { useReport } from '@/hooks/useReport';
import { useReactions, useReactionToggle } from '@/hooks/useReactions';
import { useAddedTags, useAddTag } from '@/hooks/useAddedTags';
import { usePolls } from '@/hooks/usePolls';
import { useNotifications } from '@/hooks/useNotifications';
import { NotificationBadge } from '@/components/ui/NotificationBadge';
import { useToastStore } from '@/stores/toastStore';
import { useFeedStore } from '@/stores/feedStore';
import { AnonPostCard } from '@/components/feed/AnonPostCard';
import { ScopeToggle } from '@/components/feed/ScopeToggle';
import { BlockedTagBanner } from '@/components/feed/BlockedTagBanner';
import { logEvent } from '@/lib/personalize';
import { PostCardSkeleton } from '@/components/feed/PostCardSkeleton';
import { TrendingRow } from '@/components/feed/TrendingRow';
import { PressableScale } from '@/components/ui/PressableScale';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Icon } from '@/constants/icons';
import { C, SP } from '@/design/tokens';
import { FONT } from '@/design/typography';
import { TABBAR } from '@/design/tabbar';
import type { Post } from '@/types/models';

export default function FeedScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { posts, reasonsMap, communitiesByPost, loading, refreshing, refresh, loadMore } = useFeed();
  const { blockedCount } = useTagFilter();
  const likedTags = useTagFilterStore((s) => s.likedTags);
  const scope = useFeedStore((s) => s.scope);
  const setScope = useFeedStore((s) => s.setScope);
  // 並び替えは廃止 — 常に for-you (パーソナライズ) で配信。
  // 既存ユーザーが旧 sort='hot' を localStorage に持っていても
  // mount 時に強制的に for-you へ書き戻して画面と整合させる。
  const sort = useFeedStore((s) => s.sort);
  const setSort = useFeedStore((s) => s.setSort);
  const hydrateFeed = useFeedStore((s) => s.hydrate);
  useEffect(() => {
    if (sort !== 'for-you') setSort('for-you');
  }, [sort, setSort]);
  const hasLikedTags = likedTags.length > 0;

  // 好きなタグが無いときに closed scope に居たら open へ強制
  useEffect(() => {
    if (!hasLikedTags && scope === 'closed') setScope('open');
  }, [hasLikedTags, scope, setScope]);
  const { toggle: toggleLike } = useLike();
  const { toggle: toggleConcern } = useConcern();
  const { toggle: toggleSave } = useSave();
  const { toggle: toggleReact } = useReactionToggle();
  const { unreadCount } = useNotifications();
  const { share } = useShare();
  const { report } = useReport();
  const listRef = useRef<FlashList<Post>>(null);
  const [reportPostId, setReportPostId] = useState<string | null>(null);

  useEffect(() => {
    void hydrateFeed();
  }, [hydrateFeed]);

  const postIds = posts.map((p) => p.id);
  const { data: myLikes = {} } = useLikes(postIds);
  const { data: myConcerns = {} } = useConcerns(postIds);
  const { data: mySaves = {} } = useSaves(postIds);
  const { data: reactionsByPost } = useReactions(postIds);
  const { data: addedTagsByPost } = useAddedTags(postIds);
  const { polls } = usePolls(postIds);
  const { addTag } = useAddTag();
  const { show: showToast } = useToastStore();

  const handleAddTag = useCallback(async (postId: string, tag: string) => {
    try {
      await addTag(postId, tag);
      showToast(`#${tag} を追加しました`, 'success');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('duplicate')) showToast('そのタグは既に追加されています', 'warn');
      else showToast('追加に失敗しました', 'error');
    }
  }, [addTag, showToast]);

  // Per-post handler cache. Rebuilds when `posts` (or upstream callbacks) change,
  // but NOT when toggles like myLikes/mySaves/reactions update — so cards whose
  // observable props didn't change skip re-render thanks to the AnonPostCard memo.
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
        onLike: () => {
          void logEvent({ kind: 'post_like', tags: tagNames, post_id: id });
          toggleLike(id);
        },
        onConcern: () => {
          void logEvent({ kind: 'post_concern', tags: tagNames, post_id: id });
          toggleConcern(id, !!myConcerns[id]);
        },
        onComment: () => {
          void logEvent({ kind: 'post_view', tags: tagNames, post_id: id, dwell_ms: 0 });
          router.push(`/post/${id}` as never);
        },
        onSave: () => {
          void logEvent({ kind: 'post_save', tags: tagNames, post_id: id });
          toggleSave(id);
        },
        onShare: () => share(`Geek の投稿 #${tagNames[0] ?? '雑談'}`, `/post/${id}`),
        onTagPress: (name: string) => {
          void logEvent({ kind: 'tag_click', tags: [name] });
          router.push(`/tag/${encodeURIComponent(name)}` as never);
        },
        onMore: () => setReportPostId(id),
        onReact: (meme: string) => toggleReact(id, meme),
        onAddTag: (tag: string) => handleAddTag(id, tag),
        onCommunityPress: (communityId: string) => {
          router.push(`/community/${communityId}` as never);
        },
      };
    }
    return dict;
  }, [posts, toggleLike, toggleConcern, toggleSave, toggleReact, share, router, handleAddTag, myConcerns]);

  const renderItem = useCallback(
    ({ item }: { item: Post }) => {
      const h = handlersByPostId[item.id];
      if (!h) return null;
      return (
        <AnonPostCard
          post={item}
          liked={!!myLikes[item.id]}
          concerned={!!myConcerns[item.id]}
          saved={!!mySaves[item.id]}
          reactions={reactionsByPost[item.id] ?? []}
          addedTags={addedTagsByPost[item.id] ?? []}
          poll={polls[item.id]}
          reason={reasonsMap[item.id]}
          communities={communitiesByPost[item.id] ?? []}
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
      );
    },
    [handlersByPostId, myLikes, myConcerns, mySaves, reactionsByPost, addedTagsByPost, polls, reasonsMap, communitiesByPost],
  );

  // Stable header element — recreating the inline <View> each parent render
  // would break header memoization and force TrendingRow to remount visuals.
  const ListHeader = useMemo(() => (
    <View>
      <TrendingRow />
      {blockedCount > 0 ? (
        <BlockedTagBanner count={blockedCount} onPress={() => router.push('/filter' as never)} />
      ) : null}
    </View>
  ), [blockedCount, router]);

  const Bell = Icon.bell;
  const Search = Icon.search;
  const Plus = Icon.plus;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ alignItems: 'center', backgroundColor: C.bg }}>
        <View style={{
          width: '100%', maxWidth: 720,
          paddingTop: insets.top + SP['2'],
          paddingHorizontal: SP['4'],
          paddingBottom: SP['2'],
          flexDirection: 'row',
          alignItems: 'center',
        }}>
          <PressableScale
            onPress={() => router.push('/post/create' as never)}
            haptic="confirm"
            style={{
              width: 36, height: 36, borderRadius: 18,
              backgroundColor: C.accent,
              alignItems: 'center', justifyContent: 'center',
              marginRight: SP['3'],
            }}
          >
            <Plus size={20} color="#fff" strokeWidth={2.6} />
          </PressableScale>
          <Text style={{
            flex: 1,
            fontFamily: FONT.display,
            fontSize: 28,
            color: C.text,
            letterSpacing: -0.5,
          }}>
            Geek
          </Text>
          <PressableScale onPress={() => router.push('/search' as never)} style={{ padding: SP['2'] }}>
            <Search size={22} color={C.text} strokeWidth={2.2} />
          </PressableScale>
          <PressableScale onPress={() => router.push('/notifications' as never)} style={{ padding: SP['2'] }}>
            <View>
              <Bell size={22} color={C.text} strokeWidth={2.2} />
              <NotificationBadge count={unreadCount} top={-4} right={-6} />
            </View>
          </PressableScale>
        </View>
      </View>

      {/* SortTabs は非表示 — 常にパーソナライズ (for-you) で配信。
          ユーザーには「並び替え」という概念を見せず、あなた向けが唯一のホーム体験。 */}

      <View style={{ alignItems: 'center' }}>
        <View style={{ width: '100%', maxWidth: 720, paddingHorizontal: SP['4'], paddingBottom: SP['3'] }}>
        <ScopeToggle
          value={scope}
          onChange={setScope}
          disabledClosed={!hasLikedTags}
          onClosedWhenEmpty={() => router.push('/filter' as never)}
        />
        </View>
      </View>

      <FlashList
        ref={listRef}
        data={posts}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        estimatedItemSize={300}
        ListHeaderComponent={ListHeader}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.accent} />
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
        contentContainerStyle={{
          paddingTop: SP['2'],
          paddingBottom: TABBAR.height + insets.bottom + SP['10'],
        }}
        ListEmptyComponent={
          loading ? (
            <FeedSkeleton />
          ) : (
            <EmptyState
              icon={Icon.sparkles}
              title={scope === 'closed' ? '好きなタグの投稿がまだありません' : 'まだ投稿がありません'}
              message={scope === 'closed' ? '「All」に切り替えるか、好きなタグを増やしてみよう' : 'フィルター設定を確認するか、最初の投稿をしてみよう'}
              actionLabel="投稿する"
              onAction={() => router.push('/post/create' as never)}
              tone="accent"
            />
          )
        }
      />

      <ConfirmDialog
        visible={!!reportPostId}
        title="この投稿を通報しますか？"
        message="運営に通報されます。誤った情報・スパム・誹謗中傷などが対象です。"
        confirmLabel="通報する"
        cancelLabel="キャンセル"
        destructive
        onCancel={() => setReportPostId(null)}
        onConfirm={() => {
          if (reportPostId) report({ postId: reportPostId, reason: 'other' });
          setReportPostId(null);
        }}
      />
    </View>
  );
}

function FeedSkeleton() {
  return (
    <View>
      {Array.from({ length: 3 }).map((_, i) => (
        <PostCardSkeleton key={i} />
      ))}
    </View>
  );
}
