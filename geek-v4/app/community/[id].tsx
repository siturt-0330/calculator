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
  type ListRenderItem,
} from 'react-native';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { C, R, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import { Spinner } from '@/components/ui/Spinner';
import { PressableScale } from '@/components/ui/PressableScale';
import { BackButton } from '@/components/nav/BackButton';
import { Icon } from '@/constants/icons';
import { AnonPostCard } from '@/components/feed/AnonPostCard';
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
} from '@/lib/api/communities';
import { fetchCommunityPosts } from '@/lib/api/posts';
import { fetchCommunityThreads } from '@/lib/api/bbs';
import { useToastStore } from '@/stores/toastStore';
import { useLike, useLikes } from '@/hooks/useLike';
import { useConcern, useConcerns } from '@/hooks/useConcern';
import { useSave, useSaves } from '@/hooks/useSave';
import { useShare } from '@/hooks/useShare';
import { useReactions, useReactionToggle } from '@/hooks/useReactions';
import { useAddedTags, useAddTag } from '@/hooks/useAddedTags';
import { usePolls } from '@/hooks/usePolls';
import { sanitizeContent, sanitizeUrl } from '@/lib/sanitize';
import { formatRelative } from '@/lib/utils/date';
import type { Post, BBSThread } from '@/types/models';

// ============================================================
// Types
// ============================================================
type TabKey = 'feed' | 'threads' | 'spots' | 'events' | 'compose';
type FeedSort = 'new' | 'top' | 'old';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'feed', label: 'みんなの投稿集' },
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
function deriveHandle(community: CommunityWithMembership): string {
  // ASCII 英数字に絞り込めるならそれを優先 — 残らなければ id 先頭 8 文字を fallback
  const ascii = community.name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  if (ascii.length >= 2) return ascii.slice(0, 24);
  return community.id.slice(0, 8);
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
  const [feedSort, setFeedSort] = useState<FeedSort>('new');
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
    staleTime: 30_000,
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
        show(error, 'error');
        return;
      }
      show('登録を解除しました', 'success');
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
        show(error, 'error');
        return;
      }
      show('登録しました', 'success');
    }
    void qc.invalidateQueries({ queryKey: ['community', id] });
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
            Channel header (YouTube-style)
            ============================================================ */}
        <View
          style={{
            backgroundColor: C.bg2,
            paddingHorizontal: SP['4'],
            paddingTop: SP['4'],
            paddingBottom: SP['4'],
            gap: SP['3'],
          }}
        >
          <View style={{ alignItems: 'center', gap: SP['3'] }}>
            <View
              style={{
                borderRadius: 9999,
                borderWidth: 2,
                borderColor: 'rgba(255,255,255,0.06)',
                padding: 2,
              }}
            >
              <CommunityAvatar
                icon_url={community.icon_url}
                icon_emoji={community.icon_emoji}
                icon_color={community.icon_color}
                size={community.icon_url ? 104 : 96}
              />
            </View>
            <View style={{ alignItems: 'center', gap: SP['2'] }}>
              <Text style={[T.h2, { color: C.text, textAlign: 'center', fontSize: 24 }]} numberOfLines={2}>
                {community.name}
              </Text>
              {community.is_member && (
                <View
                  style={{
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
            <Text style={[T.caption, { color: C.text3 }]}>@{handle}</Text>
            <Text style={[T.caption, { color: C.text3, textAlign: 'center' }]}>
              コミュニティ登録数 {community.member_count.toLocaleString('ja-JP')} 人 · 投稿 {community.post_count.toLocaleString('ja-JP')} 本
            </Text>
          </View>

          {/* Description (collapsible) */}
          {safeDesc.length > 0 && (
            <Pressable onPress={() => setDescExpanded((v) => !v)}>
              <Text
                style={[T.body, { color: C.text2 }]}
                numberOfLines={descExpanded ? undefined : 2}
              >
                {safeDesc}
              </Text>
              {safeDesc.length > 80 && (
                <Text style={[T.caption, { color: C.text3, marginTop: 4, fontWeight: '600' }]}>
                  {descExpanded ? '閉じる' : '...さらに表示'}
                </Text>
              )}
            </Pressable>
          )}

          {/* Tags */}
          {community.tags.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['1'] }}>
              {community.tags.map((tg) => (
                <View
                  key={tg}
                  style={{
                    paddingHorizontal: SP['2'],
                    paddingVertical: 4,
                    backgroundColor: C.accentBg,
                    borderRadius: R.full,
                  }}
                >
                  <Text style={[T.caption, { color: C.accent }]}>#{tg}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Subscribe button */}
          <SubscribeButton
            isMember={community.is_member}
            isRequestVisibility={community.visibility === 'request'}
            loading={joining}
            onPress={onJoinLeave}
          />
        </View>

        {/* Subtle separator before tabs */}
        <View style={{ height: 1, backgroundColor: C.divider }} />

        {/* ============================================================
            Tab bar
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
                  paddingVertical: SP['3'],
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
                {active && (
                  <View
                    style={{
                      height: 3,
                      width: '60%',
                      backgroundColor: C.accent,
                      borderRadius: 1.5,
                      marginTop: SP['2'],
                    }}
                  />
                )}
              </Pressable>
            );
          })}
        </View>

        {/* ============================================================
            Tab content
            ============================================================ */}
        {activeTab === 'feed' && (
          <FeedTab communityId={id} sort={feedSort} onSortChange={setFeedSort} />
        )}
        {activeTab === 'threads' && <ThreadsTab communityId={id} />}
        {activeTab === 'spots' && (
          <SpotsTab communityId={id} canCreate={community.is_member} />
        )}
        {activeTab === 'events' && (
          <EventsTab communityId={id} canCreate={community.is_member} />
        )}
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
          backgroundColor: C.bg3,
          borderRadius: R.full,
          borderWidth: 1,
          borderColor: C.border,
          paddingVertical: SP['3'],
          opacity: loading ? 0.5 : 1,
        }}
      >
        <Icon.bell size={16} color={C.text} strokeWidth={2.2} />
        <Text style={[T.bodyB, { color: C.text }]}>登録済み</Text>
        <Icon.chevronD size={14} color={C.text2} strokeWidth={2.2} />
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
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: C.accent,
        borderRadius: R.full,
        paddingVertical: SP['3'],
        opacity: loading ? 0.5 : 1,
      }}
    >
      <Text style={[T.bodyB, { color: '#fff' }]}>
        {isRequestVisibility ? '参加を申請する' : '登録する'}
      </Text>
    </PressableScale>
  );
}

// ============================================================
// Tab: みんなの投稿集 (community posts feed)
// ============================================================
function FeedTab({
  communityId,
  sort,
  onSortChange,
}: {
  communityId: string;
  sort: FeedSort;
  onSortChange: (s: FeedSort) => void;
}) {
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
      {/* Filter chips */}
      <View
        style={{
          flexDirection: 'row',
          gap: SP['2'],
          paddingHorizontal: SP['4'],
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
        <View style={{ paddingVertical: SP['10'], alignItems: 'center', gap: SP['3'] }}>
          <View
            style={{
              width: 60,
              height: 60,
              borderRadius: 30,
              backgroundColor: C.bg3,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon.community size={28} color={C.text3} strokeWidth={1.8} />
          </View>
          <Text style={[T.body, { color: C.text2 }]}>まだ投稿がありません</Text>
          <PressableScale
            onPress={() => router.push(`/post/create?community_id=${encodeURIComponent(communityId)}` as never)}
            haptic="confirm"
            style={{
              paddingHorizontal: SP['4'],
              paddingVertical: SP['2'],
              backgroundColor: C.accent,
              borderRadius: R.full,
            }}
          >
            <Text style={[T.smallM, { color: '#fff', fontWeight: '700' }]}>最初の一投をしよう</Text>
          </PressableScale>
        </View>
      ) : (
        <View>
          {posts.map((p) => (
            <AnonPostCard
              key={p.id}
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
              onMore={() => {/* no-op — could add report flow later */}}
              onReact={(meme) => toggleReact(p.id, meme)}
              onAddTag={(tag) => handleAddTag(p.id, tag)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

// ============================================================
// Tab: 掲示板 (BBS threads)
// ============================================================
function ThreadsTab({ communityId }: { communityId: string }) {
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

  if (isLoading) {
    return (
      <View style={{ paddingVertical: SP['10'], alignItems: 'center' }}>
        <Spinner size="large" />
      </View>
    );
  }

  if (threads.length === 0) {
    return (
      <View style={{ paddingVertical: SP['10'], paddingHorizontal: SP['4'], alignItems: 'center', gap: SP['3'] }}>
        <View
          style={{
            width: 60,
            height: 60,
            borderRadius: 30,
            backgroundColor: C.bg3,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon.sparkles size={28} color={C.text3} strokeWidth={1.8} />
        </View>
        <Text style={[T.body, { color: C.text2, textAlign: 'center' }]}>スレッドがありません</Text>
        <Text style={[T.caption, { color: C.text3, textAlign: 'center' }]}>
          「投稿」タブからスレッドを立てよう
        </Text>
      </View>
    );
  }

  return (
    <View style={{ paddingTop: SP['3'], paddingHorizontal: SP['4'], gap: SP['3'] }}>
      {threads.map((t) => {
        const catColor = t.category ? (CATEGORY_COLORS[t.category] ?? C.accent) : C.accent;
        return (
          <PressableScale
            key={t.id}
            onPress={() => router.push(`/bbs/${t.id}` as never)}
            haptic="tap"
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
              <Text style={[T.h4, { color: C.text, fontWeight: '700' }]} numberOfLines={2}>
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
  );
}

// ============================================================
// Tab: 聖地 (community spots)
// ============================================================
function SpotsTab({ communityId, canCreate }: { communityId: string; canCreate: boolean }) {
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
        <View style={{ paddingVertical: SP['8'], alignItems: 'center', gap: SP['2'] }}>
          <Icon.map size={40} color={C.text3} strokeWidth={1.6} />
          <Text style={[T.body, { color: C.text2, textAlign: 'center' }]}>
            聖地がまだありません
          </Text>
          <Text style={[T.caption, { color: C.text3, textAlign: 'center' }]}>
            メンバーが投稿した聖地がここに集まります
          </Text>
        </View>
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
}

// ============================================================
// Tab: カレンダー (community events)
// ============================================================
function EventsTab({ communityId, canCreate }: { communityId: string; canCreate: boolean }) {
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
        <View style={{ paddingVertical: SP['8'], alignItems: 'center', gap: SP['2'] }}>
          <Icon.calendar size={40} color={C.text3} strokeWidth={1.6} />
          <Text style={[T.body, { color: C.text2, textAlign: 'center' }]}>
            イベントがまだありません
          </Text>
          <Text style={[T.caption, { color: C.text3, textAlign: 'center' }]}>
            配信・オフ会・誕生日など何でも！
          </Text>
        </View>
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
}

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
