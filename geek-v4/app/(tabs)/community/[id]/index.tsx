// ============================================================
// Community detail — YouTube channel-style layout
// ============================================================
// 5 tabs:
//   ホーム  → みんなの投稿集 (AnonPostCard feed of community posts)
//   動画    → 掲示板         (BBS threads for this community)
//   ショート → 聖地           (community spots — list, map later)
//   ライブ  → カレンダー     (community events grouped by month)
//   投稿    → /post/create   (routes; immediately resets to feed)
// ============================================================

import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Image,
  Pressable,
  FlatList,
  ActivityIndicator,
  type ListRenderItem,
} from 'react-native';
import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { C, R, SP, SHADOW } from '../../../../design/tokens';
import { T } from '../../../../design/typography';
import { Spinner } from '../../../../components/ui/Spinner';
import { PressableScale } from '../../../../components/ui/PressableScale';
import { EmptyState } from '../../../../components/ui/EmptyState';
import { BackButton } from '../../../../components/nav/BackButton';
import { Icon } from '../../../../constants/icons';
import { AnonPostCard } from '../../../../components/feed/AnonPostCard';
import {
  fetchCommunity,
  joinCommunity,
  requestJoinCommunity,
  leaveCommunity,
  fetchCommunitySpots,
  fetchCommunityEvents,
  type CommunityWithMembership,
  type CommunitySpot,
  type CommunityEvent,
} from '../../../../lib/api/communities';
import { fetchCommunityPosts } from '../../../../lib/api/posts';
import { fetchCommunityThreads } from '../../../../lib/api/bbs';
import { useToastStore } from '../../../../stores/toastStore';
import { useLike, useLikes } from '../../../../hooks/useLike';
import { useConcern, useConcerns } from '../../../../hooks/useConcern';
import { useSave, useSaves } from '../../../../hooks/useSave';
import { useShare } from '../../../../hooks/useShare';
import { useReactions, useReactionToggle } from '../../../../hooks/useReactions';
import { useAddedTags, useAddTag } from '../../../../hooks/useAddedTags';
import { usePolls } from '../../../../hooks/usePolls';
import { sanitizeContent, sanitizeUrl } from '../../../../lib/sanitize';
import { formatRelative } from '../../../../lib/utils/date';
import type { Post, BBSThread } from '../../../../types/models';
import type { ReactionAgg } from '../../../../lib/api/reactions';
import type { Poll } from '../../../../lib/api/polls';

// ============================================================
// Types
// ============================================================
type TabKey = 'feed' | 'threads' | 'spots' | 'events' | 'compose';
type FeedSort = 'new' | 'top' | 'old';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'feed', label: 'ホーム' },
  { key: 'threads', label: '掲示板' },
  { key: 'spots', label: '聖地' },
  { key: 'events', label: 'カレンダー' },
  { key: 'compose', label: '投稿' },
];

const CATEGORY_COLORS: Record<string, string> = {
  '雑談': '#22D3A4', 'アニメ': '#FF6B7A', 'ゲーム': '#7CB1FF',
  'マンガ': '#F472B6', '音楽': '#FCD34D', 'アイドル': '#FF8C30',
  'Vtuber': '#A78BFA', '推し活': '#EC4899', 'グルメ': '#84CC16',
  'コスプレ': '#06B6D4', 'ニュース': '#94A3B8',
};

// ============================================================
// Helpers
// ============================================================
function deriveHandle(community: CommunityWithMembership): string | null {
  // ASCII only → pure handle
  if (/^[a-zA-Z0-9]+$/.test(community.name)) {
    return community.name.toLowerCase();
  }
  // Japanese / mixed → take first 6 chars of name (whitespace stripped) +
  // id4 suffix to keep it unique-ish. Return null if we can't form anything
  // readable.
  const stripped = community.name.replace(/[\s　]/g, '');
  if (stripped.length === 0) return null;
  const slug = stripped.slice(0, 6);
  return `${slug}-${community.id.slice(0, 4)}`;
}

function CommunityAvatar({
  icon_url,
  icon_emoji,
  icon_color,
  size,
}: {
  icon_url: string | null;
  icon_emoji: string;
  icon_color: string;
  size: number;
}) {
  const safeIconUrl = icon_url ? sanitizeUrl(icon_url) : null;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: safeIconUrl ? C.bg3 : icon_color,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {safeIconUrl ? (
        <Image source={{ uri: safeIconUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
      ) : (
        <Text style={{ fontSize: size * 0.55 }}>{icon_emoji}</Text>
      )}
    </View>
  );
}

// ============================================================
// Main screen
// ============================================================
export default function CommunityDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams();
  const id = typeof params.id === 'string' ? params.id : '';
  const { show } = useToastStore();
  const qc = useQueryClient();

  const [activeTab, setActiveTab] = useState<TabKey>('feed');
  // NOTE: feedSort lives inside FeedTab so changing the sort does not
  // re-render sibling tabs.
  const [descExpanded, setDescExpanded] = useState(false);
  const [joining, setJoining] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // -----------------------------------------------------------
  // Community core fetch (header)
  // -----------------------------------------------------------
  const { data: community, isLoading: communityLoading, refetch: refetchCommunity } = useQuery({
    queryKey: ['community', id],
    queryFn: () => fetchCommunity(id),
    enabled: id.length > 0,
    // コミュニティ metadata (name / icon / desc) はめったに変わらない — 2 分は信用する
    staleTime: 2 * 60_000,
  });

  // -----------------------------------------------------------
  // Tab "compose" → route to post create + reset
  // -----------------------------------------------------------
  useEffect(() => {
    if (activeTab !== 'compose') return;
    router.push(`/post/create?community_id=${encodeURIComponent(id)}` as never);
    // Reset back to feed so the tab indicator returns to ホーム
    setActiveTab('feed');
  }, [activeTab, id, router]);

  // -----------------------------------------------------------
  // Join / Leave
  // -----------------------------------------------------------
  const onJoinLeave = async () => {
    if (!community || joining) return;
    setJoining(true);
    if (community.is_member) {
      const { error } = await leaveCommunity(community.id);
      setJoining(false);
      if (error) {
        console.warn('[community] leave failed:', error);
        show(error, 'error');
        return;
      }
      show('コミュニティから抜けました', 'success');
    } else if (community.visibility === 'request') {
      const { error } = await requestJoinCommunity(community.id);
      setJoining(false);
      if (error) {
        show(error, 'error');
        return;
      }
      show('参加申請を送信しました', 'success');
    } else {
      const { error } = await joinCommunity(community.id);
      setJoining(false);
      if (error) {
        console.warn('[community] join failed:', error);
        show(error, 'error');
        return;
      }
      show('コミュニティに参加しました', 'success');
    }
    // 即座にすべての関連 query を invalidate (header / マイコミュ / 投稿先候補 全部更新)
    void qc.invalidateQueries({ queryKey: ['community', id] });
    void qc.invalidateQueries({ queryKey: ['mypage-my-communities'] });
    void qc.invalidateQueries({ queryKey: ['community-discover'] });
  };

  // -----------------------------------------------------------
  // Refresh (pull-to-refresh on the active tab's data + header)
  // -----------------------------------------------------------
  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      refetchCommunity(),
      qc.invalidateQueries({ queryKey: ['community', id, 'feed'] }),
      qc.invalidateQueries({ queryKey: ['community', id, 'threads'] }),
      qc.invalidateQueries({ queryKey: ['community', id, 'spots'] }),
      qc.invalidateQueries({ queryKey: ['community', id, 'events'] }),
    ]);
    setRefreshing(false);
  };

  // -----------------------------------------------------------
  // Loading / missing
  // -----------------------------------------------------------
  if (communityLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center' }}>
        <Spinner size="large" />
      </View>
    );
  }

  if (!community) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: C.bg,
          paddingTop: insets.top + SP['4'],
          paddingHorizontal: SP['4'],
          gap: SP['4'],
        }}
      >
        <BackButton />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: SP['3'] }}>
          <Icon.fail size={48} color={C.text3} strokeWidth={1.6} />
          <Text style={[T.h3, { color: C.text }]}>コミュニティが見つかりません</Text>
          <Text style={[T.body, { color: C.text2, textAlign: 'center' }]}>
            削除されたか、招待制で閲覧権限がない可能性があります。
          </Text>
        </View>
      </View>
    );
  }

  const handle = deriveHandle(community);
  const safeDesc = community.description.length > 0 ? sanitizeContent(community.description, { maxLength: 500 }) : '';

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + SP['20'] }}
        refreshControl={<RefreshControl tintColor={C.text2} refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Top nav bar */}
        <View
          style={{
            paddingTop: insets.top + SP['2'],
            paddingHorizontal: SP['4'],
            paddingBottom: SP['2'],
            flexDirection: 'row',
            alignItems: 'center',
            gap: SP['2'],
          }}
        >
          <BackButton />
          <View style={{ flex: 1 }} />
          {community.visibility === 'request' && (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: SP['2'],
                paddingVertical: 2,
                backgroundColor: C.amberBg,
                borderRadius: R.full,
              }}
            >
              <Icon.lock size={12} color={C.amber} strokeWidth={2.4} />
              <Text style={[T.caption, { color: C.amber, fontWeight: '600' }]}>許可制</Text>
            </View>
          )}
          {community.visibility === 'invite' && (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: SP['2'],
                paddingVertical: 2,
                backgroundColor: C.redBg,
                borderRadius: R.full,
              }}
            >
              <Icon.shield size={12} color={C.red} strokeWidth={2.4} />
              <Text style={[T.caption, { color: C.red, fontWeight: '600' }]}>招待制</Text>
            </View>
          )}
        </View>

        {/* ============================================================
            Channel header — premium centered layout
            avatar → name → @handle → tag pills → stats →
            description → subscribe CTA
            ============================================================ */}
        <View
          style={{
            backgroundColor: C.bg2,
            paddingHorizontal: SP['4'],
            paddingTop: SP['3'],
            paddingBottom: SP['4'],
            alignItems: 'center',
            gap: SP['3'],
          }}
        >
          {/* Avatar with subtle accent ring */}
          <View
            style={{
              borderRadius: 9999,
              borderWidth: 2,
              borderColor: C.accent + '40',
              padding: 3,
              ...SHADOW.card,
            }}
          >
            <CommunityAvatar
              icon_url={community.icon_url}
              icon_emoji={community.icon_emoji}
              icon_color={community.icon_color}
              size={96}
            />
          </View>

          {/* Name */}
          <View style={{ alignItems: 'center', gap: 4 }}>
            <Text
              style={[
                T.h2,
                { color: C.text, textAlign: 'center', fontSize: 24, lineHeight: 30 },
              ]}
              numberOfLines={2}
            >
              {community.name}
            </Text>
            {handle && (
              <Text style={{ color: C.text3, fontSize: 12, lineHeight: 16 }}>
                @{handle}
              </Text>
            )}
            {community.is_member && (
              <View
                style={{
                  marginTop: 4,
                  paddingHorizontal: SP['2'],
                  paddingVertical: 3,
                  backgroundColor: C.accentBg,
                  borderRadius: R.full,
                }}
              >
                <Text style={{ color: C.accent, fontSize: 11, fontWeight: '700' }}>
                  ✓ 参加中
                </Text>
              </View>
            )}
          </View>

          {/* Tag pills */}
          {community.tags.length > 0 && (
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              {community.tags.map((tg) => (
                <View
                  key={tg}
                  style={{
                    paddingHorizontal: SP['2'],
                    paddingVertical: 3,
                    backgroundColor: C.accentBg,
                    borderRadius: R.full,
                  }}
                >
                  <Text style={{ color: C.accent, fontSize: 11, fontWeight: '600' }}>
                    #{tg}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* Compact stats */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: SP['2'],
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Icon.community size={12} color={C.text3} strokeWidth={2.2} />
              <Text style={{ color: C.text2, fontSize: 12, fontWeight: '700' }}>
                {community.member_count.toLocaleString('ja-JP')}
              </Text>
              <Text style={{ color: C.text3, fontSize: 12 }}>メンバー</Text>
            </View>
            <Text style={{ color: C.text4, fontSize: 12 }}>·</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Icon.bbs size={12} color={C.text3} strokeWidth={2.2} />
              <Text style={{ color: C.text2, fontSize: 12, fontWeight: '700' }}>
                {community.post_count.toLocaleString('ja-JP')}
              </Text>
              <Text style={{ color: C.text3, fontSize: 12 }}>投稿</Text>
            </View>
          </View>

          {/* Description (collapsible) */}
          {safeDesc.length > 0 && (
            <Pressable
              onPress={() => setDescExpanded((v) => !v)}
              style={{ alignSelf: 'stretch' }}
            >
              <Text
                style={[T.body, { color: C.text2, textAlign: 'center' }]}
                numberOfLines={descExpanded ? undefined : 3}
              >
                {safeDesc}
              </Text>
              {safeDesc.length > 80 && (
                <Text
                  style={{
                    color: C.text3,
                    fontSize: 12,
                    fontWeight: '600',
                    marginTop: 4,
                    textAlign: 'center',
                  }}
                >
                  {descExpanded ? '閉じる' : '...もっと見る'}
                </Text>
              )}
            </Pressable>
          )}

          {/* Subscribe CTA (full width) */}
          <View style={{ alignSelf: 'stretch', marginTop: SP['1'] }}>
            <SubscribeButton
              isMember={community.is_member}
              isRequestVisibility={community.visibility === 'request'}
              loading={joining}
              onPress={onJoinLeave}
            />
          </View>
        </View>

        {/* ============================================================
            Tab bar — bottom border 区切り + active underline
            (hairline 区切り line は border で兼ねる)
            ============================================================ */}
        <View
          style={{
            flexDirection: 'row',
            borderBottomWidth: 1,
            borderBottomColor: C.border,
            backgroundColor: C.bg,
          }}
        >
          {TABS.map((t) => {
            const active = activeTab === t.key;
            return (
              <Pressable
                key={t.key}
                onPress={() => setActiveTab(t.key)}
                style={{
                  flex: 1,
                  alignItems: 'center',
                  paddingTop: SP['3'],
                  paddingBottom: 0,
                }}
              >
                <Text
                  style={[
                    T.smallM,
                    {
                      color: active ? C.text : C.text2,
                      fontWeight: active ? '700' : '600',
                    },
                  ]}
                  numberOfLines={1}
                >
                  {t.label}
                </Text>
                <View
                  style={{
                    height: 3,
                    width: '60%',
                    backgroundColor: active ? C.accent : 'transparent',
                    borderRadius: 1.5,
                    marginTop: SP['2'],
                  }}
                />
              </Pressable>
            );
          })}
        </View>

        {/* ============================================================
            Tab content — all tabs rendered, only the active one is
            visible. This avoids unmount/remount + refetch on every
            tab switch (the heaviest source of jank).
            ============================================================ */}
        <View style={{ display: activeTab === 'feed' ? 'flex' : 'none' }}>
          <FeedTab communityId={id} />
        </View>
        <View style={{ display: activeTab === 'threads' ? 'flex' : 'none' }}>
          <ThreadsTab communityId={id} />
        </View>
        <View style={{ display: activeTab === 'spots' ? 'flex' : 'none' }}>
          <SpotsTab communityId={id} canCreate={community.is_member} />
        </View>
        <View style={{ display: activeTab === 'events' ? 'flex' : 'none' }}>
          <EventsTab communityId={id} canCreate={community.is_member} />
        </View>
        {/* compose tab navigates away in the effect above */}
      </ScrollView>
    </View>
  );
}

// ============================================================
// Subscribe button
// ============================================================
function SubscribeButton({
  isMember,
  isRequestVisibility,
  loading,
  onPress,
}: {
  isMember: boolean;
  isRequestVisibility: boolean;
  loading: boolean;
  onPress: () => void;
}) {
  if (isMember) {
    return (
      <PressableScale
        onPress={onPress}
        haptic="tap"
        disabled={loading}
        style={{
          alignSelf: 'stretch',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: SP['2'],
          backgroundColor: 'transparent',
          borderRadius: R.full,
          borderWidth: 1.5,
          borderColor: C.border2,
          paddingVertical: SP['3'],
          opacity: loading ? 0.5 : 1,
        }}
      >
        <Icon.bell size={15} color={C.text2} strokeWidth={2.2} />
        <Text style={[T.bodyB, { color: C.text2, fontWeight: '700' }]}>参加中</Text>
        <Icon.chevronD size={13} color={C.text3} strokeWidth={2.2} />
      </PressableScale>
    );
  }
  return (
    <PressableScale
      onPress={onPress}
      haptic="confirm"
      disabled={loading}
      style={{
        alignSelf: 'stretch',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: SP['2'],
        backgroundColor: C.accent,
        borderRadius: R.full,
        paddingVertical: SP['3'],
        opacity: loading ? 0.7 : 1,
        ...SHADOW.accentGlow,
      }}
    >
      {loading && <ActivityIndicator size="small" color="#fff" />}
      <Text style={[T.bodyB, { color: '#fff', fontWeight: '700' }]}>
        {loading ? '処理中…' : isRequestVisibility ? '参加を申請する' : 'コミュニティに参加する'}
      </Text>
    </PressableScale>
  );
}

// ============================================================
// Tab: みんなの投稿集 (community posts feed)
// ============================================================
type FeedTabProps = {
  communityId: string;
};
const FeedTab = memo(function FeedTab({ communityId }: FeedTabProps) {
  const [sort, setSort] = useState<FeedSort>('new');
  const onSortChange = useCallback((s: FeedSort) => setSort(s), []);
  const router = useRouter();
  const { show: showToast } = useToastStore();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['community', communityId, 'feed', sort],
    queryFn: async () => {
      // map our 'old' to ascending — fetchCommunityPosts only supports 'new'|'top'|'hot'|'for-you'
      // we hack 'old' by fetching 'new' and reversing client-side
      const mapped = sort === 'top' ? 'top' : 'new';
      const r = await fetchCommunityPosts({ community_id: communityId, sort: mapped, limit: 40 });
      const posts = sort === 'old' ? [...r.posts].reverse() : r.posts;
      return posts;
    },
    enabled: communityId.length > 0,
    staleTime: 20_000,
  });

  useEffect(() => {
    if (isError) showToast('投稿の取得に失敗しました', 'error');
  }, [isError, showToast]);

  const posts: Post[] = data ?? [];
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
    <View style={{ paddingVertical: SP['3'] }}>
      {/* Filter chips — paddingTop for breathing room from tab bar */}
      <View
        style={{
          flexDirection: 'row',
          gap: SP['2'],
          paddingHorizontal: SP['4'],
          paddingTop: SP['3'],
          paddingBottom: SP['3'],
        }}
      >
        {(
          [
            { v: 'new', label: '新しい順' },
            { v: 'top', label: '人気順' },
            { v: 'old', label: '古い順' },
          ] as const
        ).map((opt) => {
          const active = sort === opt.v;
          return (
            <PressableScale
              key={opt.v}
              onPress={() => onSortChange(opt.v)}
              haptic="tap"
              style={{
                paddingHorizontal: SP['3'],
                paddingVertical: 6,
                backgroundColor: active ? C.text : C.bg2,
                borderRadius: R.full,
                borderWidth: 1,
                borderColor: active ? C.text : C.border,
              }}
            >
              <Text
                style={[
                  T.caption,
                  { color: active ? C.bg : C.text2, fontWeight: '700' },
                ]}
              >
                {opt.label}
              </Text>
            </PressableScale>
          );
        })}
      </View>

      {isLoading ? (
        <View style={{ paddingVertical: SP['10'], alignItems: 'center' }}>
          <Spinner size="large" />
        </View>
      ) : posts.length === 0 ? (
        <EmptyState
          icon={Icon.community}
          title="まだ投稿がありません"
          message="最初の一投を投稿して、このコミュニティを盛り上げよう"
          actionLabel="投稿する"
          onAction={() =>
            router.push(`/post/create?community_id=${encodeURIComponent(communityId)}` as never)
          }
          tone="accent"
        />
      ) : (
        <View>
          {posts.map((p) => (
            <FeedPostRow
              key={p.id}
              post={p}
              liked={!!myLikes[p.id]}
              concerned={!!myConcerns[p.id]}
              saved={!!mySaves[p.id]}
              reactions={reactionsByPost[p.id] ?? []}
              addedTags={addedTagsByPost[p.id] ?? []}
              poll={polls[p.id]}
              toggleLike={toggleLike}
              toggleConcern={toggleConcern}
              toggleSave={toggleSave}
              toggleReact={toggleReact}
              share={share}
              router={router}
              handleAddTag={handleAddTag}
            />
          ))}
        </View>
      )}
    </View>
  );
});

// ------------------------------------------------------------
// Memoized row — prevents recreating callbacks per AnonPostCard
// on every FeedTab render. Identity-stable handlers come from the
// parent via props, and per-row closures are isolated here so a
// single post's state change won't re-render the others.
// ------------------------------------------------------------
type FeedPostRowProps = {
  post: Post;
  liked: boolean;
  concerned: boolean;
  saved: boolean;
  reactions: ReactionAgg[];
  addedTags: string[];
  poll: Poll | undefined;
  toggleLike: (id: string) => void;
  toggleConcern: (id: string, current: boolean) => void;
  toggleSave: (id: string) => void;
  toggleReact: (id: string, meme: string) => void;
  share: (title: string, path: string) => Promise<void>;
  router: ReturnType<typeof useRouter>;
  handleAddTag: (postId: string, tag: string) => Promise<void>;
};
const FeedPostRow = memo(function FeedPostRow({
  post,
  liked,
  concerned,
  saved,
  reactions,
  addedTags,
  poll,
  toggleLike,
  toggleConcern,
  toggleSave,
  toggleReact,
  share,
  router,
  handleAddTag,
}: FeedPostRowProps) {
  const onLike = useCallback(() => toggleLike(post.id), [toggleLike, post.id]);
  const onConcern = useCallback(
    () => toggleConcern(post.id, concerned),
    [toggleConcern, post.id, concerned],
  );
  const onComment = useCallback(
    () => router.push(`/post/${post.id}` as never),
    [router, post.id],
  );
  const onSave = useCallback(() => toggleSave(post.id), [toggleSave, post.id]);
  const onShare = useCallback(
    () => share(`Geek の投稿 #${post.tag_names[0] ?? '雑談'}`, `/post/${post.id}`),
    [share, post.id, post.tag_names],
  );
  const onTagPress = useCallback(
    (name: string) => router.push(`/tag/${encodeURIComponent(name)}` as never),
    [router],
  );
  const onMore = useCallback(() => {
    /* no-op — could add report flow later */
  }, []);
  const onReact = useCallback(
    (meme: string) => toggleReact(post.id, meme),
    [toggleReact, post.id],
  );
  const onAddTag = useCallback(
    (tag: string) => {
      void handleAddTag(post.id, tag);
    },
    [handleAddTag, post.id],
  );
  return (
    <AnonPostCard
      post={post}
      liked={liked}
      concerned={concerned}
      saved={saved}
      reactions={reactions}
      addedTags={addedTags}
      poll={poll}
      onLike={onLike}
      onConcern={onConcern}
      onComment={onComment}
      onSave={onSave}
      onShare={onShare}
      onTagPress={onTagPress}
      onMore={onMore}
      onReact={onReact}
      onAddTag={onAddTag}
    />
  );
});

// ============================================================
// Tab: 掲示板 (BBS threads)
// ============================================================
const ThreadsTab = memo(function ThreadsTab({ communityId }: { communityId: string }) {
  const router = useRouter();
  const { show: showToast } = useToastStore();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['community', communityId, 'threads'],
    queryFn: () => fetchCommunityThreads(communityId, { sort: 'new' }),
    enabled: communityId.length > 0,
    staleTime: 20_000,
  });

  useEffect(() => {
    if (isError) showToast('スレッドの取得に失敗しました', 'error');
  }, [isError, showToast]);

  const threads: BBSThread[] = data ?? [];

  const goCreate = useCallback(() => {
    router.push(`/bbs/create?community_id=${encodeURIComponent(communityId)}` as never);
  }, [router, communityId]);

  // -----------------------------------------------------------
  // Sticky-style CTA banner — always visible above the thread list
  // -----------------------------------------------------------
  const banner = (
    <PressableScale
      onPress={goCreate}
      haptic="confirm"
      scaleValue={0.98}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['3'],
        marginHorizontal: SP['4'],
        marginBottom: SP['3'],
        paddingHorizontal: SP['3'],
        paddingVertical: SP['3'],
        backgroundColor: C.accent + '12',
        borderWidth: 1,
        borderColor: C.accent + '40',
        borderRadius: R.lg,
      }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: C.accent + '33',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon.edit size={20} color={C.accent} strokeWidth={2.4} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[T.bodyM, { color: C.text, fontWeight: '700' }]}>
          + スレッドを立てる
        </Text>
        <Text style={[T.small, { color: C.text2, marginTop: 2 }]} numberOfLines={1}>
          このコミュニティで新しい話題を始めよう
        </Text>
      </View>
      <Icon.chevronR size={18} color={C.text3} strokeWidth={2.2} />
    </PressableScale>
  );

  // -----------------------------------------------------------
  // Floating action button — bottom-right of the tab content
  // -----------------------------------------------------------
  const fab = (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        right: SP['4'],
        bottom: SP['4'],
        zIndex: 10,
      }}
    >
      <PressableScale
        onPress={goCreate}
        haptic="confirm"
        scaleValue={0.92}
        style={{
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: C.accent,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: C.accent,
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.4,
          shadowRadius: 12,
          elevation: 8,
        }}
      >
        <Icon.edit size={24} color="#fff" strokeWidth={2.6} />
      </PressableScale>
    </View>
  );

  if (isLoading) {
    return (
      <View style={{ paddingVertical: SP['10'], alignItems: 'center' }}>
        <Spinner size="large" />
      </View>
    );
  }

  if (threads.length === 0) {
    return (
      <View style={{ paddingTop: SP['3'] }}>
        {banner}
        <View
          style={{
            paddingHorizontal: SP['6'],
            paddingTop: SP['6'],
            paddingBottom: SP['8'],
            alignItems: 'center',
            gap: SP['3'],
          }}
        >
          <View
            style={{
              width: 96,
              height: 96,
              borderRadius: 48,
              backgroundColor: C.accent + '1A',
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: C.accent + '33',
            }}
          >
            <Icon.bbs size={48} color={C.accent} strokeWidth={1.8} />
          </View>
          <Text
            style={[T.h3, { color: C.text, textAlign: 'center', fontWeight: '700' }]}
          >
            最初のスレッドを立ててみよう 💬
          </Text>
          <Text
            style={[
              T.body,
              {
                color: C.text2,
                textAlign: 'center',
                lineHeight: 22,
                maxWidth: 320,
              },
            ]}
          >
            気になる話題、質問、雑談、何でも！{'\n'}
            このコミュニティが盛り上がるきっかけになるかも
          </Text>
          <PressableScale
            onPress={goCreate}
            haptic="confirm"
            scaleValue={0.97}
            style={{
              alignSelf: 'stretch',
              marginTop: SP['3'],
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: SP['2'],
              backgroundColor: C.accent,
              borderRadius: R.lg,
              paddingVertical: SP['4'],
              ...SHADOW.accentGlow,
            }}
          >
            <Icon.edit size={20} color="#fff" strokeWidth={2.6} />
            <Text style={[T.bodyB, { color: '#fff', fontWeight: '700' }]}>
              + スレッドを立てる
            </Text>
          </PressableScale>
        </View>
      </View>
    );
  }

  return (
    <View style={{ paddingTop: SP['3'], paddingBottom: SP['10'] }}>
      {banner}
      <View style={{ paddingHorizontal: SP['4'], gap: SP['3'] }}>
        {threads.map((t) => {
          const catColor = t.category ? (CATEGORY_COLORS[t.category] ?? C.accent) : C.accent;
          return (
            <PressableScale
              key={t.id}
              onPress={() => router.push(`/bbs/${t.id}` as never)}
              haptic="tap"
              scaleValue={0.99}
              style={{
                flexDirection: 'row',
                borderRadius: R.lg,
                backgroundColor: C.bg2,
                borderWidth: 1,
                borderColor: C.border,
                overflow: 'hidden',
              }}
            >
              <View style={{ width: 4, backgroundColor: catColor }} />
              <View style={{ flex: 1, padding: SP['3'], gap: SP['2'] }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
                  {t.category && (
                    <View
                      style={{
                        paddingHorizontal: SP['2'],
                        paddingVertical: 2,
                        backgroundColor: catColor + '22',
                        borderRadius: R.sm,
                        borderWidth: 1,
                        borderColor: catColor + '55',
                      }}
                    >
                      <Text style={[T.caption, { color: catColor, fontWeight: '700', fontSize: 10 }]}>
                        {t.category}
                      </Text>
                    </View>
                  )}
                  {/* 公開範囲バッジ — community_only か public かを一目で */}
                  {t.visibility === 'community_only' ? (
                    <View
                      style={{
                        paddingHorizontal: 6,
                        paddingVertical: 2,
                        backgroundColor: C.amber + '20',
                        borderRadius: R.full,
                        borderWidth: 1,
                        borderColor: C.amber + '60',
                      }}
                    >
                      <Text style={{ fontSize: 10, color: C.amber, fontWeight: '700' }}>
                        🔒 限定
                      </Text>
                    </View>
                  ) : t.visibility === 'public' ? (
                    <View
                      style={{
                        paddingHorizontal: 6,
                        paddingVertical: 2,
                        backgroundColor: 'transparent',
                        borderRadius: R.full,
                        borderWidth: 1,
                        borderColor: C.border,
                      }}
                    >
                      <Text style={{ fontSize: 10, color: C.text3, fontWeight: '700' }}>
                        🌐 公開
                      </Text>
                    </View>
                  ) : null}
                  <View style={{ flex: 1 }} />
                  <Text style={[T.caption, { color: C.text3, fontSize: 11 }]}>
                    {formatRelative(t.last_reply_at ?? t.created_at)}
                  </Text>
                </View>
                <Text style={[T.bodyMd, { color: C.text, fontWeight: '700' }]} numberOfLines={2}>
                  {t.title}
                </Text>
                <View style={{ flexDirection: 'row', gap: SP['3'], alignItems: 'center' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Icon.comment size={13} color={C.text3} strokeWidth={2.2} />
                    <Text style={[T.small, { color: C.text3, fontWeight: '600' }]}>
                      {t.replies_count.toLocaleString('ja-JP')}
                    </Text>
                  </View>
                </View>
              </View>
            </PressableScale>
          );
        })}
      </View>
      {fab}
    </View>
  );
});

// ============================================================
// Tab: 聖地 (community spots)
// ============================================================
const SpotsTab = memo(function SpotsTab({ communityId, canCreate }: { communityId: string; canCreate: boolean }) {
  const router = useRouter();
  const { show: showToast } = useToastStore();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['community', communityId, 'spots'],
    queryFn: () => fetchCommunitySpots(communityId),
    enabled: communityId.length > 0,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (isError) showToast('聖地の取得に失敗しました', 'error');
  }, [isError, showToast]);

  const spots: CommunitySpot[] = data ?? [];

  const renderItem: ListRenderItem<CommunitySpot> = ({ item }) => {
    const safePhoto = item.photo_url ? sanitizeUrl(item.photo_url) : null;
    return (
      <View
        style={{
          flexDirection: 'row',
          gap: SP['3'],
          padding: SP['3'],
          backgroundColor: C.bg2,
          borderRadius: R.lg,
          borderWidth: 1,
          borderColor: C.border,
        }}
      >
        <View
          style={{
            width: 80,
            height: 80,
            borderRadius: R.md,
            backgroundColor: C.bg3,
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          {safePhoto ? (
            <Image source={{ uri: safePhoto }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          ) : (
            <Text style={{ fontSize: 28 }}>📍</Text>
          )}
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[T.bodyB, { color: C.text }]} numberOfLines={1}>
            {item.name}
          </Text>
          {item.description.length > 0 && (
            <Text style={[T.small, { color: C.text2 }]} numberOfLines={2}>
              {item.description}
            </Text>
          )}
          <Text style={[T.mono, { color: C.text3, fontSize: 10 }]} numberOfLines={1}>
            {item.lat.toFixed(5)}, {item.lon.toFixed(5)}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <View style={{ paddingTop: SP['3'], paddingHorizontal: SP['4'], gap: SP['3'] }}>
      {canCreate && (
        <PressableScale
          onPress={() => router.push(`/community/${communityId}/spot/create` as never)}
          haptic="confirm"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            paddingVertical: SP['2'],
            backgroundColor: C.accentBg,
            borderRadius: R.full,
            borderWidth: 1,
            borderColor: C.accentSoft,
          }}
        >
          <Icon.plus size={16} color={C.accent} strokeWidth={2.4} />
          <Text style={[T.smallM, { color: C.accent, fontWeight: '700' }]}>聖地を追加</Text>
        </PressableScale>
      )}
      {isLoading ? (
        <View style={{ paddingVertical: SP['8'], alignItems: 'center' }}>
          <Spinner size="large" />
        </View>
      ) : spots.length === 0 ? (
        <EmptyState
          icon={Icon.map}
          title="まだ聖地がありません"
          message="メンバーが投稿した場所がここに集まります"
          tone="green"
        />
      ) : (
        <FlatList
          data={spots}
          keyExtractor={(it) => it.id}
          renderItem={renderItem}
          ItemSeparatorComponent={() => <View style={{ height: SP['2'] }} />}
          scrollEnabled={false}
        />
      )}
    </View>
  );
});

// ============================================================
// Tab: カレンダー (community events)
// ============================================================
const EventsTab = memo(function EventsTab({ communityId, canCreate }: { communityId: string; canCreate: boolean }) {
  const router = useRouter();
  const { show: showToast } = useToastStore();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['community', communityId, 'events'],
    queryFn: () => fetchCommunityEvents(communityId, { upcomingOnly: false }),
    enabled: communityId.length > 0,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (isError) showToast('イベントの取得に失敗しました', 'error');
  }, [isError, showToast]);

  const events: CommunityEvent[] = data ?? [];

  // Group by YYYY 年 MM 月
  const grouped = useMemo(() => {
    const map = new Map<string, CommunityEvent[]>();
    for (const ev of events) {
      const d = new Date(ev.starts_at);
      if (Number.isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()} 年 ${(d.getMonth() + 1).toString().padStart(2, '0')} 月`;
      const arr = map.get(key) ?? [];
      arr.push(ev);
      map.set(key, arr);
    }
    return Array.from(map.entries());
  }, [events]);

  return (
    <View style={{ paddingTop: SP['3'], paddingHorizontal: SP['4'], gap: SP['3'] }}>
      {canCreate && (
        <PressableScale
          onPress={() => router.push(`/community/${communityId}/event/create` as never)}
          haptic="confirm"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            paddingVertical: SP['2'],
            backgroundColor: C.accentBg,
            borderRadius: R.full,
            borderWidth: 1,
            borderColor: C.accentSoft,
          }}
        >
          <Icon.plus size={16} color={C.accent} strokeWidth={2.4} />
          <Text style={[T.smallM, { color: C.accent, fontWeight: '700' }]}>イベントを追加</Text>
        </PressableScale>
      )}
      {isLoading ? (
        <View style={{ paddingVertical: SP['8'], alignItems: 'center' }}>
          <Spinner size="large" />
        </View>
      ) : events.length === 0 ? (
        <EmptyState
          icon={Icon.calendar}
          title="まだイベントがありません"
          message="配信・オフ会・誕生日など、何でも気軽に追加できます"
          tone="amber"
        />
      ) : (
        grouped.map(([monthLabel, monthEvents]) => (
          <View key={monthLabel} style={{ gap: SP['2'] }}>
            <Text style={[T.smallB, { color: C.text2, marginTop: SP['2'] }]}>{monthLabel}</Text>
            {monthEvents.map((ev) => (
              <EventRow key={ev.id} event={ev} />
            ))}
          </View>
        ))
      )}
    </View>
  );
});

function EventRow({ event }: { event: CommunityEvent }) {
  const d = new Date(event.starts_at);
  const valid = !Number.isNaN(d.getTime());
  const day = valid ? d.getDate() : '?';
  const weekday = valid
    ? ['日', '月', '火', '水', '木', '金', '土'][d.getDay()] ?? ''
    : '';
  const time = valid
    ? `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
    : '';
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: SP['3'],
        padding: SP['3'],
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
      }}
    >
      <View
        style={{
          width: 56,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: C.bg3,
          borderRadius: R.md,
          paddingVertical: SP['2'],
        }}
      >
        <Text style={[T.numLg, { color: C.text }]}>{day}</Text>
        <Text style={[T.caption, { color: C.text3 }]}>{weekday}</Text>
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[T.bodyB, { color: C.text }]} numberOfLines={2}>
          {event.title}
        </Text>
        <Text style={[T.caption, { color: C.text3 }]}>{time}</Text>
        {event.location_text && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icon.map size={12} color={C.text3} strokeWidth={2.2} />
            <Text style={[T.small, { color: C.text2 }]} numberOfLines={1}>
              {event.location_text}
            </Text>
          </View>
        )}
        {event.description.length > 0 && (
          <Text style={[T.small, { color: C.text2 }]} numberOfLines={3}>
            {event.description}
          </Text>
        )}
      </View>
    </View>
  );
}
