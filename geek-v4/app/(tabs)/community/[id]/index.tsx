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
  TextInput,
  Modal,
  type ListRenderItem,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { C, R, SP, SHADOW } from '../../../../design/tokens';
import { T } from '../../../../design/typography';
import { SPRING_TIGHT } from '../../../../design/motion';
import { Spinner } from '../../../../components/ui/Spinner';
import { TABBAR } from '../../../../design/tabbar';
import { PressableScale } from '../../../../components/ui/PressableScale';
import { EmptyState } from '../../../../components/ui/EmptyState';
import { BackButton } from '../../../../components/nav/BackButton';
import { Icon } from '../../../../constants/icons';
import { AnonPostCard } from '../../../../components/feed/AnonPostCard';
import { CommunityStampRow } from '../../../../components/feed/CommunityStampRow';
import {
  useCommunityStamps,
  useCommunityStampReactions,
  useCommunityStampReactionToggle,
} from '../../../../hooks/useCommunityStamps';
import { OfficialBadge } from '../../../../components/community/OfficialBadge';
import { EventRow } from '../../../../components/community/EventRow';
import { OfficialFeatureNav } from '../../../../components/community/OfficialFeatureNav';
import { CommunityMyProfileTab } from '../../../../components/community/CommunityMyProfileTab';
import { useAuthStore } from '../../../../stores/authStore';
import {
  fetchCommunity,
  joinCommunity,
  requestJoinCommunity,
  leaveCommunity,
  fetchCommunitySpots,
  fetchCommunityEvents,
  toggleSpotCertified,
  updateCommunity,
  SPOT_CATEGORY_META,
  COMMUNITY_GENRE_META,
  SELECTABLE_GENRES,
  type CommunityWithMembership,
  type CommunitySpot,
  type CommunityEvent,
  type CommunityGenre,
  type SpotCategory,
} from '../../../../lib/api/communities';
import {
  getTabsFor,
  type CommunityTabKey,
} from '../../../../lib/community/tabSets';
import { effectiveGenre, setGenreOverride } from '../../../../lib/community/genreOverride';
import { fetchCommunityPosts } from '../../../../lib/api/posts';
import { fetchCommunityThreads } from '../../../../lib/api/bbs';
// Q&A 関連 import は廃止 (2026-05) — QnaTabInline 撤去に伴い
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
// タブ構成は lib/community/tabSets.ts に集約 (genre 別 + 公式コミュ別の決定論)。
// 本ファイルは活動状態 (activeTab / visitedTabs) と panel 表示制御だけを担う。
type TabKey = CommunityTabKey;
type FeedSort = 'new' | 'top' | 'old';

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
  // タブを開いたかの sticky フラグ。一度開いたタブは display:none でも mount を維持し、
  // 再 fetch を避ける (keep-alive)。 初期表示時は feed タブの query しか走らない。
  // → 4 並列の Supabase RTT を 1 つに減らし、コミュニティ詳細の first paint が大幅に軽くなる。
  const [visitedTabs, setVisitedTabs] = useState<Record<TabKey, boolean>>({
    feed: true,
    threads: false,
    spots: false,
    events: false,
    compose: false,
    comments: false,
    search: false,
    profile: false,
  });
  useEffect(() => {
    if (!visitedTabs[activeTab]) {
      setVisitedTabs((prev) => ({ ...prev, [activeTab]: true }));
    }
  }, [activeTab, visitedTabs]);

  // NOTE: feedSort lives inside FeedTab so changing the sort does not
  // re-render sibling tabs.
  const [descExpanded, setDescExpanded] = useState(false);
  const [joining, setJoining] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // ジャンル変更モーダル (migration 0044 未適用環境でも local override で変更可)
  const [genreModalOpen, setGenreModalOpen] = useState(false);

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
  // Join / Leave (optimistic — 1000 並行参加でも UI 即応)
  // -----------------------------------------------------------
  // 旧版は RPC 完了を待ってからボタンの状態が変わっていたため、ピーク時の
  // server-side レイテンシ (200-800ms) がそのまま体感ラグになっていた。
  // 楽観更新で「参加中」表示を先に切り替え、失敗時のみ revert する。
  const onJoinLeave = async () => {
    if (!community || joining) return;
    setJoining(true);

    // 楽観更新: header の is_member / member_count を即座に切り替える
    const wasMember = community.is_member;
    const isRequest = community.visibility === 'request';
    if (!isRequest) {
      qc.setQueryData(
        ['community', id],
        (prev: CommunityWithMembership | undefined) => {
          if (!prev) return prev;
          return {
            ...prev,
            is_member: !wasMember,
            role: !wasMember ? 'member' : null,
            member_count: Math.max(0, prev.member_count + (wasMember ? -1 : 1)),
          };
        },
      );
    }

    let err: string | null = null;
    if (wasMember) {
      err = (await leaveCommunity(community.id)).error;
    } else if (isRequest) {
      err = (await requestJoinCommunity(community.id)).error;
    } else {
      err = (await joinCommunity(community.id)).error;
    }
    setJoining(false);

    if (err) {
      console.warn('[community] join/leave failed:', err);
      show(err, 'error');
      // 失敗時は revert (= server truth 再取得)
      void qc.invalidateQueries({ queryKey: ['community', id] });
      return;
    }

    if (wasMember) show('コミュニティから抜けました', 'success');
    else if (isRequest) show('参加申請を送信しました', 'success');
    else show('コミュニティに参加しました', 'success');

    // 即座に全関連 query を invalidate
    // 注意: queryKey は実際に各画面で使われているキーに揃えること。
    // 過去版は ['mypage-my-communities'] / ['community-discover'] という
    // 存在しない key を invalidate していて、コミュタブのリストが古いまま
    // 残るバグになっていた。
    void qc.invalidateQueries({ queryKey: ['community', id] });
    // コミュタブ index.tsx (React Query 化済) — user.id サフィックス含めて prefix 一致
    void qc.invalidateQueries({ queryKey: ['my-communities'] });
    void qc.invalidateQueries({ queryKey: ['my-community-feed'] });
    // mypage の統計 (KPI: コミュ数)
    void qc.invalidateQueries({ queryKey: ['mypage-stats'] });
    // discover 画面
    void qc.invalidateQueries({ queryKey: ['discover-search'] });
    void qc.invalidateQueries({ queryKey: ['discover-official'] });
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
  // ユーザー報告: 「打ち込んだ文章と異なる」
  // 原因: 保存時 (createCommunity / updateCommunity) で既に sanitizeContent 済みの
  // description を、表示時にも再度 sanitize していた。これにより:
  //   - trim() で 前後の改行 / 空白 が再度落とされる
  //   - <文字列> のような HTML 風表記が二度目で別の判定になる可能性
  //   - 連続改行が再度圧縮される
  // 保存時に正規化したものをそのまま表示するのが正しい。Web 版では
  // <Text> がエスケープするので追加 sanitize なしでも XSS 安全。
  const safeDesc = community.description ?? '';

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: TABBAR.height + insets.bottom + SP['10'] }}
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
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
              <Text
                style={[
                  T.h2,
                  { color: C.text, textAlign: 'center', fontSize: 24, lineHeight: 30 },
                ]}
                numberOfLines={2}
              >
                {community.name}
              </Text>
              {community.is_official && <OfficialBadge size="md" />}
            </View>
            {handle && (
              <Text style={{ color: C.text3, fontSize: 12, lineHeight: 16 }}>
                @{handle}
              </Text>
            )}
            {community.is_official && community.official_admin_display_name && (
              <Text style={[T.small, { color: C.text2, textAlign: 'center', marginTop: 2 }]}>
                管理者: {community.official_admin_display_name}
                {community.official_organization ? ` · ${community.official_organization}` : ''}
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

          {/* ジャンル badge (tap で変更モーダル) と「コミュニティを編集」ボタンを横並び */}
          {!community.is_official && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6 }}>
              {(() => {
                const currentGenre = effectiveGenre(id, community.genre);
                const meta = COMMUNITY_GENRE_META[currentGenre];
                return (
                  <PressableScale
                    onPress={() => setGenreModalOpen(true)}
                    haptic="tap"
                    accessibilityLabel={`ジャンル ${meta.label} — タップして変更`}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      paddingHorizontal: SP['3'],
                      paddingVertical: 4,
                      backgroundColor: C.bg3,
                      borderRadius: R.full,
                      borderWidth: 1,
                      borderColor: C.border,
                    }}
                  >
                    <Text style={{ fontSize: 13 }}>{meta.emoji}</Text>
                    <Text style={{ color: C.text2, fontSize: 12, fontWeight: '700' }}>
                      {meta.label}
                    </Text>
                    <Icon.edit size={10} color={C.text3} strokeWidth={2.2} />
                  </PressableScale>
                );
              })()}
              {/* 編集 (wiki edit, migration 0048) — member 全員可 */}
              {community.is_member && (
                <PressableScale
                  onPress={() => router.push(`/community/${id}/edit` as never)}
                  haptic="tap"
                  accessibilityLabel="コミュニティを編集"
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    paddingHorizontal: SP['3'],
                    paddingVertical: 4,
                    backgroundColor: C.bg3,
                    borderRadius: R.full,
                    borderWidth: 1,
                    borderColor: C.border,
                  }}
                >
                  <Icon.edit size={11} color={C.text2} strokeWidth={2.4} />
                  <Text style={{ color: C.text2, fontSize: 12, fontWeight: '700' }}>
                    編集
                  </Text>
                </PressableScale>
              )}
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
              // 説明が短ければ tap しても何も起きないので、Press 領域は変えるが
              // 「タップで展開」アフォーダンスは "もっと見る" が見えるときだけ。
              onPress={() => safeDesc.length > 80 && setDescExpanded((v) => !v)}
              style={{ alignSelf: 'stretch', paddingVertical: 2 }}
              hitSlop={6}
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
                    color: C.accent,
                    fontSize: 12,
                    fontWeight: '700',
                    marginTop: 4,
                    textAlign: 'center',
                  }}
                >
                  {descExpanded ? '閉じる' : 'もっと見る ↓'}
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

          {/* 公式登録の申請機能は廃止 (2026-05)。
              Geek 公式アカウント (migration 0033 で seed 済) 以外には公式バッジを
              付与しない方針へ転換。詳細は HYPOTHESIS_LOG.md 参照。 */}
        </View>

        {/* 公式機能ピル (Q&A / カレンダー / 地図) は廃止 —
            タブ自体に統合されたので、上部のチップ navigation は表示しない */}

        {/* ============================================================
            Tab bar — bottom border 区切り + sliding active underline
            公式コミュニティでは「掲示板→Q&A」「投稿→コメント」にラベル差し替え
            ============================================================ */}
        <CommunityTabBar
          activeTab={activeTab}
          onChange={setActiveTab}
          isOfficial={!!community.is_official}
          genre={effectiveGenre(id, community.genre)}
        />

        {/* ============================================================
            Tab content — lazy mount: 一度開いたタブだけ mount、以降は
            display:none で keep-alive (再 fetch を避ける)。
            初期表示時は feed タブだけが mount され、threads / spots /
            events の query は触られないので first paint が軽い。
            ============================================================ */}
        <View style={{ display: activeTab === 'feed' ? 'flex' : 'none' }}>
          <FeedTab communityId={id} />
        </View>
        {visitedTabs.threads && (
          <View style={{ display: activeTab === 'threads' ? 'flex' : 'none' }}>
            {/* 公式コミュも一般と同じ ThreadsTab を使用。
                Q&A (AI 自動回答) 機能は廃止 (コスト × ハルシネーション問題)。
                公式 = 「Q&A タブ」だった旧 UX は、CommunityTabBar 側で
                ラベルを "Q&A" のまま残すか "掲示板" に揃えるかを別途決める。 */}
            <ThreadsTab communityId={id} />
          </View>
        )}
        {visitedTabs.spots && (
          <View style={{ display: activeTab === 'spots' ? 'flex' : 'none' }}>
            <SpotsTab
              communityId={id}
              canCreate={community.is_member}
              community={community}
              onGoToEvents={() => {
                setVisitedTabs((prev) => ({ ...prev, events: true }));
                setActiveTab('events');
              }}
            />
          </View>
        )}
        {visitedTabs.events && (
          <View style={{ display: activeTab === 'events' ? 'flex' : 'none' }}>
            <EventsTab communityId={id} canCreate={community.is_member} />
          </View>
        )}
        {/* 公式コミュニティの「コメント」タブ — 一般ユーザーが唯一書き込める BBS スレッド一覧。
            掲示板タブと同じ ThreadsTab を流用 (UX 統一) */}
        {community.is_official && visitedTabs.comments && (
          <View style={{ display: activeTab === 'comments' ? 'flex' : 'none' }}>
            <ThreadsTab communityId={id} />
          </View>
        )}
        {/* compose tab navigates away in the effect above (一般コミュニティのみ) */}

        {/* === migration 0044 で追加された新タブ (本 PR では stub) === */}
        {visitedTabs.search && (
          <View style={{ display: activeTab === 'search' ? 'flex' : 'none' }}>
            <ComingSoonTab
              emoji="🔍"
              title="検索 (準備中)"
              body={
                'Instagram の発見タブのように、投稿された写真・動画を' +
                'グリッドで一覧できる画面を予定しています。'
              }
            />
          </View>
        )}
        {visitedTabs.profile && (
          <View style={{ display: activeTab === 'profile' ? 'flex' : 'none' }}>
            <CommunityMyProfileTab
              communityId={id}
              isMember={community.is_member}
            />
          </View>
        )}
      </ScrollView>

      {/* === 新ジャンル用の「投稿」FAB ===
          migration 0044 で新規ジャンル (oshi / creative / experience / discussion) は
          'compose' タブを持たないので、代替として右下に FAB を出して post create を
          開く。legacy / official は従来通り tab 経由なので FAB は出さない。 */}
      {!community.is_official &&
        effectiveGenre(id, community.genre) !== 'legacy' && (
          <PressableScale
            onPress={() =>
              router.push(`/post/create?community_id=${encodeURIComponent(id)}` as never)
            }
            haptic="confirm"
            accessibilityLabel="このコミュニティに投稿する"
            style={{
              position: 'absolute',
              right: SP['5'],
              bottom: insets.bottom + TABBAR.height + SP['4'],
              width: 56,
              height: 56,
              borderRadius: 28,
              backgroundColor: C.accent,
              alignItems: 'center',
              justifyContent: 'center',
              shadowColor: C.accent,
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.45,
              shadowRadius: 12,
              elevation: 6,
            }}
          >
            <Icon.plus size={26} color="#fff" strokeWidth={2.8} />
          </PressableScale>
        )}

      {/* === ジャンル変更モーダル (local override + server 試行) === */}
      <GenreChangeModal
        visible={genreModalOpen}
        currentGenre={effectiveGenre(id, community.genre)}
        onClose={() => setGenreModalOpen(false)}
        onPick={async (g) => {
          setGenreOverride(id, g);
          setGenreModalOpen(false);
          // server にも書きにいく — migration 適用済なら更新、未適用なら
          // updateCommunity 内の defensive で genre が外されるが、local override は残る
          await updateCommunity(id, { genre: g });
          // community キャッシュを invalidate して tab が再描画されるように
          void qc.invalidateQueries({ queryKey: ['community', id] });
          show(`ジャンルを「${COMMUNITY_GENRE_META[g].label}」に変更しました`, 'success');
        }}
      />
    </View>
  );
}

// ============================================================
// GenreChangeModal — community 詳細のジャンル変更モーダル
// ------------------------------------------------------------
// migration 0044 未適用環境でも UI 操作だけでタブ構成を切り替えられる
// (local override に保存)。migration 適用済なら updateCommunity が server も更新。
// ============================================================
function GenreChangeModal({
  visible,
  currentGenre,
  onClose,
  onPick,
}: {
  visible: boolean;
  currentGenre: CommunityGenre;
  onClose: () => void;
  onPick: (g: CommunityGenre) => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
        <View
          style={{
            backgroundColor: C.bg2,
            borderTopLeftRadius: R['2xl'],
            borderTopRightRadius: R['2xl'],
            padding: SP['4'],
            paddingBottom: insets.bottom + SP['4'],
            gap: SP['3'],
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
            <Text style={[T.h3, { color: C.text, flex: 1 }]}>ジャンルを変更</Text>
            <PressableScale
              onPress={onClose}
              haptic="tap"
              hitSlop={12}
              accessibilityLabel="閉じる"
              style={{ padding: SP['2'] }}
            >
              <Icon.close size={20} color={C.text2} strokeWidth={2.4} />
            </PressableScale>
          </View>
          <Text style={[T.caption, { color: C.text3 }]}>
            タブ構成がジャンルに合わせて変わります
          </Text>
          <View style={{ gap: SP['2'] }}>
            {SELECTABLE_GENRES.map((g) => {
              const meta = COMMUNITY_GENRE_META[g];
              const isActive = g === currentGenre;
              return (
                <PressableScale
                  key={g}
                  onPress={() => onPick(g)}
                  haptic="select"
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: SP['3'],
                    padding: SP['3'],
                    backgroundColor: isActive ? C.accent + '22' : C.bg3,
                    borderRadius: R.md,
                    borderWidth: 1.5,
                    borderColor: isActive ? C.accent : 'transparent',
                  }}
                >
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 20,
                      backgroundColor: C.bg2,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ fontSize: 22 }}>{meta.emoji}</Text>
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[T.bodyB, { color: C.text, fontWeight: '700' }]}>
                      {meta.label}
                    </Text>
                    <Text style={[T.caption, { color: C.text3 }]} numberOfLines={2}>
                      {meta.description}
                    </Text>
                  </View>
                  {isActive && (
                    <Icon.check size={18} color={C.accent} strokeWidth={2.6} />
                  )}
                </PressableScale>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ============================================================
// 準備中タブの共通プレースホルダ
// ============================================================
// 検索 / マイプロフィール タブは migration 0044 で追加されたが、中身の実装は
// 後続 PR。本 PR では「準備中」とビジョンを伝える stub のみを出す。
// 引き算原則: タブだけ用意して画面が真っ白だと user が不安になる → 説明を出す。
function ComingSoonTab({
  emoji,
  title,
  body,
}: {
  emoji: string;
  title: string;
  body: string;
}) {
  return (
    <View
      style={{
        paddingHorizontal: SP['6'],
        paddingTop: SP['8'],
        paddingBottom: SP['8'],
        alignItems: 'center',
        gap: SP['3'],
      }}
    >
      <Text style={{ fontSize: 48 }}>{emoji}</Text>
      <Text style={[T.h4, { color: C.text, textAlign: 'center' }]}>{title}</Text>
      <Text style={[T.small, { color: C.text2, textAlign: 'center', lineHeight: 20 }]}>
        {body}
      </Text>
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
          opacity: loading ? 0.6 : 1,
        }}
      >
        {loading ? (
          <ActivityIndicator size="small" color={C.text2} />
        ) : (
          <Icon.bell size={15} color={C.text2} strokeWidth={2.2} />
        )}
        <Text style={[T.bodyB, { color: C.text2, fontWeight: '700' }]}>
          {loading ? '処理中…' : '参加中'}
        </Text>
        {!loading && <Icon.chevronD size={13} color={C.text3} strokeWidth={2.2} />}
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
// Community tab bar — 5 等分 + sliding underline
// ============================================================
function CommunityTabBar({
  activeTab,
  onChange,
  isOfficial = false,
  genre,
}: {
  activeTab: TabKey;
  onChange: (k: TabKey) => void;
  isOfficial?: boolean;
  genre: CommunityGenre | undefined;
}) {
  const tabs = getTabsFor(genre, isOfficial);
  const [barW, setBarW] = useState(0);
  const segW = barW / tabs.length;
  const idx = tabs.findIndex((t) => t.key === activeTab);
  const x = useSharedValue(0);

  useEffect(() => {
    if (segW > 0) x.value = withSpring(idx * segW, SPRING_TIGHT);
  }, [idx, segW, x]);

  const underlineStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value + segW * 0.2 }],
    width: segW * 0.6,
  }));

  return (
    <View
      onLayout={(e) => setBarW(e.nativeEvent.layout.width)}
      style={{
        flexDirection: 'row',
        borderBottomWidth: 1,
        borderBottomColor: C.border,
        backgroundColor: C.bg,
        position: 'relative',
      }}
    >
      {tabs.map((t) => {
        const active = activeTab === t.key;
        return (
          <Pressable
            key={t.key}
            onPress={() => onChange(t.key)}
            style={{
              flex: 1,
              alignItems: 'center',
              paddingTop: SP['3'],
              paddingBottom: SP['3'] + 3, // underline 分の余白
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
          </Pressable>
        );
      })}
      {/* sliding underline — 全 tab に対する絶対配置で animate */}
      {segW > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              bottom: 0,
              left: 0,
              height: 3,
              borderRadius: 1.5,
              backgroundColor: C.accent,
            },
            underlineStyle,
          ]}
        />
      )}
    </View>
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

  // ===== コミュ専用スタンプ =====
  // このコミュで作成されたスタンプ一覧 + 各 post の集計を取得
  const { data: communityStamps = [] } = useCommunityStamps(communityId);
  const { data: stampReactionsByPost = {} } = useCommunityStampReactions(postIds);
  const stampToggle = useCommunityStampReactionToggle();
  // ★ mutate() ではなく toggle() を使う:
  // toggle() は hook 内部で (postId+stampId) ごとの in-flight Set を握り、
  // server roundtrip 中の連打を無視する。pending state が parent に伝わる前に
  // 再 tap されると DELETE×2 が並走して use_count が二重消費される critical bug
  // を防ぐための最後の defense。
  const handleStampReact = useCallback(
    (postId: string, stampId: string) => {
      stampToggle.toggle({ postId, stampId });
    },
    [stampToggle],
  );

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
        // re-throw to keep AddTagInline open with the entered text — silent close gave
        // the false impression "added" when actually mutation rejected.
        throw e;
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
            <View key={p.id}>
              <FeedPostRow
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
              {/* コミュ専用スタンプ行 (投稿カードの直下に出す)
                  バグ修正: 旧版は `onReact={(stampId) => handleStampReact(p.id, ...)}`
                  と毎回新規 arrow を渡しており、CommunityStampRow の memo / React
                  reconciliation 経由で post.id の closure が別 post の id に
                  入れ替わるバグが発生。postId を props で渡して handler は
                  useCallback で安定化したものを直接渡す形に変更。 */}
              <CommunityStampRow
                postId={p.id}
                communityId={communityId}
                stamps={communityStamps}
                reactions={stampReactionsByPost[p.id] ?? []}
                onReact={handleStampReact}
              />
            </View>
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
  // promise を return することで AddTagInline.submit の await が実際の結果を待つ。
  // 旧版は void で握り潰しており失敗時も form が即 close → 「追加された風」だけ表示。
  const onAddTag = useCallback(
    (tag: string) => handleAddTag(post.id, tag),
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
const SpotsTab = memo(function SpotsTab({
  communityId,
  canCreate,
  community,
  onGoToEvents,
}: {
  communityId: string;
  canCreate: boolean;
  community: CommunityWithMembership;
  onGoToEvents: () => void;
}) {
  const router = useRouter();
  const { show: showToast } = useToastStore();
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);
  const isOfficialAdmin = !!userId && community.official_admin_user_id === userId;

  const { data, isLoading, isError } = useQuery({
    queryKey: ['community', communityId, 'spots'],
    queryFn: () => fetchCommunitySpots(communityId),
    enabled: communityId.length > 0,
    staleTime: 30_000,
  });

  // migration 0046: spot_id 付き upcoming イベントを取得 → spot 別件数で badge 表示
  const { data: upcomingEvents = [] } = useQuery({
    queryKey: ['community', communityId, 'events', 'upcoming'],
    queryFn: () => fetchCommunityEvents(communityId, { upcomingOnly: true }),
    enabled: communityId.length > 0,
    staleTime: 60_000,
  });
  const eventCountBySpot = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of upcomingEvents) {
      if (e.spot_id) m.set(e.spot_id, (m.get(e.spot_id) ?? 0) + 1);
    }
    return m;
  }, [upcomingEvents]);

  useEffect(() => {
    if (isError) showToast('聖地の取得に失敗しました', 'error');
  }, [isError, showToast]);

  const spots: CommunitySpot[] = data ?? [];

  const toggleCertify = useMutation({
    mutationFn: ({ spotId, certified }: { spotId: string; certified: boolean }) =>
      toggleSpotCertified(spotId, certified),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['community', communityId, 'spots'] });
      showToast(vars.certified ? '公認に設定しました' : '公認を解除しました', 'success');
    },
    onError: (e: unknown) => {
      showToast(e instanceof Error ? e.message : '公認設定に失敗しました', 'error');
    },
  });

  const renderItem: ListRenderItem<CommunitySpot> = ({ item }) => {
    const safePhoto = item.photo_url ? sanitizeUrl(item.photo_url) : null;
    const meta = SPOT_CATEGORY_META[(item.category as SpotCategory) ?? 'other'];
    const upcomingCount = eventCountBySpot.get(item.id) ?? 0;
    return (
      <View
        style={{
          flexDirection: 'row',
          gap: SP['3'],
          padding: SP['3'],
          backgroundColor: C.bg2,
          borderRadius: R.lg,
          borderWidth: 1,
          borderColor: item.is_certified ? C.accent + '55' : meta.color + '33',
          borderLeftWidth: 4,
          borderLeftColor: meta.color,
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
            <Text style={{ fontSize: 28 }}>{meta.emoji}</Text>
          )}
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={[T.bodyB, { color: C.text, flexShrink: 1 }]} numberOfLines={1}>
              {item.name}
            </Text>
            {item.is_certified && (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 3,
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  backgroundColor: C.accentBg,
                  borderRadius: R.full,
                  borderWidth: 1,
                  borderColor: C.accent + '55',
                }}
              >
                <Icon.shield size={10} color={C.accent} strokeWidth={2.6} />
                <Text style={{ fontSize: 10, color: C.accent, fontWeight: '700' }}>公認</Text>
              </View>
            )}
            <View style={{ flex: 1 }} />
            {isOfficialAdmin && (
              <PressableScale
                onPress={() =>
                  toggleCertify.mutate({ spotId: item.id, certified: !item.is_certified })
                }
                haptic="tap"
                style={{
                  padding: 6,
                  borderRadius: R.full,
                  backgroundColor: item.is_certified ? C.accentBg : C.bg3,
                  borderWidth: 1,
                  borderColor: item.is_certified ? C.accent + '55' : C.border,
                }}
              >
                <Icon.shield
                  size={12}
                  color={item.is_certified ? C.accent : C.text3}
                  strokeWidth={2.4}
                />
              </PressableScale>
            )}
            <PressableScale
              onPress={() => router.push(`/community/${communityId}/spot/${item.id}/edit` as never)}
              haptic="tap"
              hitSlop={6}
              accessibilityLabel={`${item.name} を編集`}
              style={{
                padding: 6,
                borderRadius: R.full,
                backgroundColor: C.bg3,
                borderWidth: 1,
                borderColor: C.border,
              }}
            >
              <Icon.edit size={12} color={C.text2} strokeWidth={2.4} />
            </PressableScale>
          </View>
          {/* カテゴリ chip */}
          <View
            style={{
              alignSelf: 'flex-start',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 3,
              paddingHorizontal: 6,
              paddingVertical: 1,
              backgroundColor: meta.color + '22',
              borderRadius: R.full,
              borderWidth: 1,
              borderColor: meta.color + '55',
            }}
          >
            <Text style={{ fontSize: 10 }}>{meta.emoji}</Text>
            <Text style={{ fontSize: 10, color: meta.color, fontWeight: '700' }}>
              {meta.label}
            </Text>
          </View>
          {item.description.length > 0 && (
            <Text style={[T.small, { color: C.text2 }]} numberOfLines={2}>
              {item.description}
            </Text>
          )}
          {upcomingCount > 0 && (
            <PressableScale
              onPress={onGoToEvents}
              haptic="tap"
              hitSlop={4}
              accessibilityLabel={`この聖地の直近イベント ${upcomingCount} 件を見る`}
              style={{
                alignSelf: 'flex-start',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: 6,
                paddingVertical: 2,
                backgroundColor: C.accent + '22',
                borderRadius: R.full,
                borderWidth: 1,
                borderColor: C.accent + '55',
              }}
            >
              <Icon.calendar size={10} color={C.accent} strokeWidth={2.6} />
              <Text style={{ fontSize: 10, color: C.accent, fontWeight: '700' }}>
                直近イベント {upcomingCount} 件
              </Text>
            </PressableScale>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={{ paddingTop: SP['3'], paddingHorizontal: SP['4'], gap: SP['3'] }}>
      <View style={{ flexDirection: 'row', gap: SP['2'] }}>
        {canCreate && (
          <PressableScale
            onPress={() => router.push(`/community/${communityId}/spot/create` as never)}
            haptic="confirm"
            style={{
              flex: 1,
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
        {spots.length > 0 && (
          <PressableScale
            onPress={() => router.push(`/community/${communityId}/spot/map` as never)}
            haptic="tap"
            accessibilityLabel="聖地マップを開く"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              paddingHorizontal: SP['4'],
              paddingVertical: SP['2'],
              backgroundColor: C.bg3,
              borderRadius: R.full,
              borderWidth: 1,
              borderColor: C.border,
            }}
          >
            <Icon.map size={16} color={C.text2} strokeWidth={2.4} />
            <Text style={[T.smallM, { color: C.text2, fontWeight: '700' }]}>マップ</Text>
          </PressableScale>
        )}
      </View>
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

  // event.spot_id → spot 情報の lookup 用 (migration 0046)
  // spots は SpotsTab 側のキャッシュを使い回し
  const { data: spots = [] } = useQuery({
    queryKey: ['community', communityId, 'spots'],
    queryFn: () => fetchCommunitySpots(communityId),
    enabled: communityId.length > 0,
    staleTime: 30_000,
  });
  const spotById = useMemo(() => {
    const m = new Map<string, CommunitySpot>();
    for (const s of spots) m.set(s.id, s);
    return m;
  }, [spots]);

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
              <EventRow key={ev.id} event={ev} spot={ev.spot_id ? spotById.get(ev.spot_id) ?? null : null} />
            ))}
          </View>
        ))
      )}
    </View>
  );
});

// OwnerApplyOfficialCta は廃止 (2026-05): 公式登録の申請機能をなくし、
// Geek 公式 (migration 0033 seed) のみが is_official=true を持つ方針へ転換。

// QnaTabInline は廃止 (2026-05): AI 自動回答の事業構造的トレードオフ
// (コスト × ハルシネーション) により Q&A 機能ごと撤去。
// 公式コミュも一般コミュと同じ ThreadsTab を使う。

// OfficialFeatureNav は components/community/OfficialFeatureNav.tsx に切り出し済み (Phase 8 split)

// EventRow は components/community/EventRow.tsx に切り出し済み (Phase 8 split)
