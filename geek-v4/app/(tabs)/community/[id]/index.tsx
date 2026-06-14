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
  StyleSheet,
  RefreshControl,
  Pressable,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { C, R, SP } from '../../../../design/tokens';
import { T } from '../../../../design/typography';
import Animated, { useSharedValue, FadeInDown } from 'react-native-reanimated';
import { useColors } from '../../../../hooks/useColors';
import { useReducedMotion } from '../../../../hooks/useReducedMotion';
import { CommunityCollapsingHeader, HEADER_EXPANDED } from '../../../../components/community/CommunityCollapsingHeader';
import { CommunitySortTabs, type FeedSort } from '../../../../components/community/CommunitySortTabs';
import { Spinner } from '../../../../components/ui/Spinner';
import { TABBAR } from '../../../../design/tabbar';
import { PressableScale } from '../../../../components/ui/PressableScale';
import { BackButton } from '../../../../components/nav/BackButton';
import { Icon } from '../../../../constants/icons';
import { AnonPostCard } from '../../../../components/feed/AnonPostCard';
import { ReportSheet } from '../../../../components/post/ReportSheet';
import { CommunityContestsSection } from '../../../../components/contest/CommunityContestsSection';
import { useAuthStore } from '../../../../stores/authStore';
import { useRecentCommunitiesStore } from '../../../../stores/recentCommunitiesStore';
import { useDelayedLoading } from '../../../../hooks/useDelayedLoading';
import {
  fetchCommunity,
  joinCommunity,
  requestJoinCommunity,
  leaveCommunity,
  type CommunityWithMembership,
} from '../../../../lib/api/communities';
import type { CommunityTabKey } from '../../../../lib/community/tabSets';
import { fetchCommunityPosts } from '../../../../lib/api/posts';
// Q&A 関連 import は廃止 (2026-05) — QnaTabInline 撤去に伴い
import { useToastStore } from '../../../../stores/toastStore';
import { useLike, useLikes } from '../../../../hooks/useLike';
import { useConcern, useConcerns } from '../../../../hooks/useConcern';
import { useSave, useSaves } from '../../../../hooks/useSave';
import { useShare } from '../../../../hooks/useShare';
import { useReactions, useReactionToggle } from '../../../../hooks/useReactions';
import { useAddedTags, useAddTag } from '../../../../hooks/useAddedTags';
import { usePolls } from '../../../../hooks/usePolls';
import { useFeedPage } from '../../../../hooks/useFeedPage';
import type { Post } from '../../../../types/models';
import type { ReactionAgg } from '../../../../lib/api/reactions';
import type { Poll } from '../../../../lib/api/polls';

// ============================================================
// Types
// ============================================================
// タブ構成は lib/community/tabSets.ts に集約 (genre 別 + 公式コミュ別の決定論)。
// 本ファイルは活動状態 (activeTab / visitedTabs) と panel 表示制御だけを担う。
type TabKey = CommunityTabKey;


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
  const stripped = community.name.replace(/\s/g, '');
  if (stripped.length === 0) return null;
  const slug = stripped.slice(0, 6);
  return `${slug}-${community.id.slice(0, 4)}`;
}

// ============================================================
// Main screen
// ============================================================
export default function CommunityDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams();
  const id = typeof params.id === 'string' ? params.id : '';
  const show = useToastStore((s) => s.show);
  const qc = useQueryClient();
  // current user id — AdminBanner の owner fallback (created_by === user.id) で使う
  const currentUserId = useAuthStore((s) => s.user?.id) ?? null;

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
  const [joining, setJoining] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // コラプシング・ヘッダー駆動用のスクロール位置(1本だけ持ち header に渡す)。
  const scrollY = useSharedValue(0);
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollY.value = e.nativeEvent.contentOffset.y;
    },
    [scrollY],
  );

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
  // Smart skeleton timing — Spinner only after 200ms of continuous loading.
  // <200ms loads (cache hits via staleTime) skip flash entirely.
  const showCommunitySpinner = useDelayedLoading(communityLoading, 200);

  // ===== 最近見たコミュニティ履歴に記録 (HomeDrawer「履歴」用) =====
  // community ロード完了時に LRU へ前置。refetch で参照が変わっても id で dedupe。
  const recordRecentCommunity = useRecentCommunitiesStore((s) => s.record);
  useEffect(() => {
    if (!community) return;
    recordRecentCommunity({
      id: community.id,
      name: community.name,
      icon_url: community.icon_url,
      icon_emoji: community.icon_emoji,
      icon_color: community.icon_color,
      member_count: community.member_count,
    });
  }, [community, recordRecentCommunity]);

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
    const wasMember = community.is_member;
    const isRequest = community.visibility === 'request';
    // ★ owner は退会できない(leaveCommunity が拒否)。楽観 leave を出すと member_count が
    //   一瞬減って戻る「チラつき」+ エラートーストになるので、タップを即無効化して案内のみ。
    if (wasMember && community.role === 'owner') {
      show('オーナーはコミュニティから抜けられません', 'warn');
      return;
    }
    setJoining(true);

    // 楽観更新: header の is_member / member_count を即座に切り替える
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
    } else if (!wasMember) {
      // 参加申請 (request 制): has_pending_request を即時 true にして
      // 「申請」→「申請中」のボタン反転を確定する (refetch までのチラつき防止)。
      qc.setQueryData(
        ['community', id],
        (prev: CommunityWithMembership | undefined) =>
          prev ? { ...prev, has_pending_request: true } : prev,
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
    // ★ コミュタブ feed の現用キーは ['my-community-feed-rich']。旧 ['my-community-feed'] は
    //   読み手ゼロのデッドキーで、join/leave がコミュタブに反映されない原因だった。
    void qc.invalidateQueries({ queryKey: ['my-community-feed-rich'] });
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
        {showCommunitySpinner ? <Spinner size="large" /> : null}
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
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingTop: insets.top + HEADER_EXPANDED, paddingBottom: TABBAR.height + insets.bottom + SP['10'] }}
        refreshControl={<RefreshControl tintColor={C.text2} refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* ============================================================
            Admin Banner (mod 限定) — header 直下に strip で出す。
            「あなたはこのコミュニティの管理人です」+ 管理 / 編集 CTA。
            isModerator = community.role === 'owner' | 'admin'
            (= useIsCommunityMod と同じロジック; community 取得時に
             既に role が一緒に取れているので追加 RTT 不要)。
            Fallback: role が null でも created_by === user.id なら mod 扱い。
            ============================================================ */}
        <AdminBanner
          communityId={id}
          isModerator={
            community.role === 'owner' ||
            community.role === 'admin' ||
            community.created_by === currentUserId
          }
        />

        {/* ============================================================
            Tab content — ホーム (= みんなの投稿集 feed) のみを表示。
            旧版にあった
              - CommunitySubTabs (chip 行: ホーム/掲示板/マップ/カレンダー/管理人)
              - CommunityTabBar (underline tab: feed/threads/spots/events)
            は重複していたため両方撤去。
            掲示板 / マップ / カレンダー / 管理 は URL 直打ち or AdminBanner CTA から
            引き続きアクセス可能 (route は残存)。
            ============================================================ */}
        <CommunityIdentityBlock
          description={safeDesc}
          memberCount={community.member_count}
          postCount={community.post_count}
          isOfficial={!!community.is_official}
          officialAdminName={community.official_admin_display_name ?? null}
          officialOrganization={community.official_organization ?? null}
        />
        <CommunityContestsSection communityId={id} />
        <FeedTab communityId={id} />
      </Animated.ScrollView>

      {/* コラプシング・ヘッダー(ScrollView の外=固定。content は paddingTop 168 で下に逃がす)。
          投稿作成 FAB は TabBar 側に一本化済みのため独自 FAB は描画しない。 */}
      <CommunityCollapsingHeader
        scrollY={scrollY}
        topInset={insets.top}
        name={community.name}
        handle={handle}
        iconUrl={community.icon_url}
        iconEmoji={community.icon_emoji}
        iconColor={community.icon_color}
        isOfficial={!!community.is_official}
        coverUrl={null}
        visibility={community.visibility}
        isMember={community.is_member}
        isRequestVisibility={community.visibility === 'request'}
        hasPendingRequest={community.has_pending_request ?? false}
        joining={joining}
        onJoinLeave={onJoinLeave}
      />
    </View>
  );
}

// ============================================================
// AdminBanner — mod 限定で hero 直下に出す strip
// ------------------------------------------------------------
// 「あなたはこのコミュニティの管理人です」+ 管理画面への CTA。
// `/community/[id]/admin` (= 管理者専用画面) に遷移する。
// 編集 (member 全員可) もここから併設しておくことで、 hero から chip 群を
// 撤去した穴を埋める。
// ============================================================
function AdminBanner({
  communityId,
  isModerator,
}: {
  communityId: string;
  isModerator: boolean;
}) {
  const router = useRouter();
  if (!isModerator) return null;
  return (
    <View
      style={{
        backgroundColor: C.accentBg,
        paddingHorizontal: SP['4'],
        paddingVertical: SP['3'],
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['2'],
        borderTopWidth: 1,
        borderBottomWidth: 1,
        borderColor: C.accent + '40',
      }}
    >
      <Icon.shield size={18} color={C.accent} strokeWidth={2.4} />
      <Text style={[T.smallM, { color: C.text, flex: 1, fontWeight: '700' }]} numberOfLines={1}>
        あなたはこのコミュニティの管理人です
      </Text>
      <PressableScale
        onPress={() => router.push(`/community/${communityId}/edit` as never)}
        haptic="tap"
        hitSlop={8}
        accessibilityLabel="コミュニティを編集"
        style={{ paddingHorizontal: SP['2'], paddingVertical: 4 }}
      >
        <Text style={[T.smallM, { color: C.text2, fontWeight: '700' }]}>編集</Text>
      </PressableScale>
      <PressableScale
        onPress={() => router.push(`/community/${communityId}/admin` as never)}
        haptic="tap"
        hitSlop={8}
        accessibilityLabel="管理画面へ移動"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 2,
          paddingHorizontal: SP['2'],
          paddingVertical: 4,
        }}
      >
        <Text style={[T.smallM, { color: C.accent, fontWeight: '800' }]}>管理</Text>
        <Icon.chevronR size={14} color={C.accent} strokeWidth={2.6} />
      </PressableScale>
    </View>
  );
}

// ============================================================
// ジャンル別タブバー (CommunityTabBar) は撤去 (2026-05)。
// #95 feat/community-genre-tabs の underline タブは dead code 化していた
// ため削除。詳細画面は FeedTab (ホーム) のみを描画し、掲示板 / 聖地 /
// カレンダー / 管理は個別 route からアクセスする。
// ============================================================

// ============================================================
// Tab: みんなの投稿集 (community posts feed)
// ============================================================
// ============================================================
// CommunityIdentityBlock — 公式管理者名 / 説明(折りたたみ) / メンバー証跡
// ------------------------------------------------------------
// 重量級の FeedTab(投稿リスト)から切り離した memo 子。descExpanded を内部 state に
// 持つことで、参加/退会(member_count 変化)・説明の続きを読む・ソート切替で投稿カード
// (最大40枚)を再レンダさせない(監査 H1 回帰の修正)。画面はこのブロックを FeedTab の
// 兄弟として描く。
// ============================================================
type CommunityIdentityBlockProps = {
  description: string;
  memberCount: number;
  postCount: number;
  isOfficial: boolean;
  officialAdminName: string | null;
  officialOrganization: string | null;
};
const CommunityIdentityBlock = memo(function CommunityIdentityBlock({
  description,
  memberCount,
  postCount,
  isOfficial,
  officialAdminName,
  officialOrganization,
}: CommunityIdentityBlockProps) {
  const C = useColors();
  const reduce = useReducedMotion();
  const [descExpanded, setDescExpanded] = useState(false);
  const hasAdmin = isOfficial && !!officialAdminName;
  // 日本語は全角20字/行前後。2行 clamp と整合させ、短文の「黙って切れる」を防ぐ閾値。
  const descTruncatable = description.length > 40;
  const dotCount = Math.min(3, memberCount);
  return (
    <Animated.View
      entering={reduce ? undefined : FadeInDown.duration(220)}
      style={{
        paddingHorizontal: SP['5'],
        paddingTop: SP['5'],
        paddingBottom: SP['5'],
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: C.divider,
      }}
    >
      {hasAdmin ? (
        <Text style={[T.small, { color: C.text2 }]}>
          管理者: {officialAdminName}
          {officialOrganization ? ` · ${officialOrganization}` : ''}
        </Text>
      ) : null}
      {description.length > 0 ? (
        <Pressable
          onPress={() => descTruncatable && setDescExpanded((v) => !v)}
          hitSlop={6}
          style={{ marginTop: hasAdmin ? SP['2'] : 0 }}
        >
          <Text style={[T.body, { color: C.text2 }]} numberOfLines={descExpanded ? undefined : 2}>
            {description}
          </Text>
          {descTruncatable ? (
            <Text style={[T.smallM, { color: C.text3, marginTop: SP['1'] }]}>
              {descExpanded ? '閉じる' : '続きを読む'}
            </Text>
          ) : null}
        </Pressable>
      ) : null}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          marginTop: description.length > 0 || hasAdmin ? SP['4'] : 0,
        }}
      >
        {memberCount >= 1 ? (
          <View style={{ flexDirection: 'row' }}>
            {[C.bg3, C.bg4, C.bg5].slice(0, dotCount).map((col, i) => (
              <View
                key={col}
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: R.full,
                  backgroundColor: col,
                  borderWidth: 2,
                  borderColor: C.bg,
                  marginLeft: i === 0 ? 0 : -7,
                }}
              />
            ))}
          </View>
        ) : null}
        <Text style={{ marginLeft: memberCount >= 1 ? SP['2'] : 0 }}>
          <Text style={[T.smallB, { color: C.text2 }]}>{memberCount.toLocaleString('ja-JP')}</Text>
          <Text style={[T.small, { color: C.text3 }]}>
            {` 人 · ${postCount.toLocaleString('ja-JP')} 投稿`}
          </Text>
        </Text>
      </View>
    </Animated.View>
  );
});

type FeedTabProps = {
  communityId: string;
};
const FeedTab = memo(function FeedTab({ communityId }: FeedTabProps) {
  const C = useColors();
  const [sort, setSort] = useState<FeedSort>('new');
  const onSortChange = useCallback((s: FeedSort) => setSort(s), []);
  const [reportPostId, setReportPostId] = useState<string | null>(null);
  const router = useRouter();
  const showToast = useToastStore((s) => s.show);
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
    // ソート切替で全面スピナーにせず前回結果を保持(深スクロール時のちらつき回避)。
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    if (isError) showToast('投稿の取得に失敗しました', 'error');
  }, [isError, showToast]);

  const posts = useMemo<Post[]>(() => data ?? [], [data]);
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

  // ★ de-anon Phase2: コミュニティ詳細では投稿者本人のアバター + 擬似ハンドル(id)を表示する。
  //   その identity (avatar_url / avatar_emoji / pseudonym_id / official_author / is_own) は
  //   author_id 非依存で get_feed_page RPC (useFeedPage) が server 側マスクして供給する。
  //   REST (fetchCommunityPosts) は本文 / counter のみで identity を持たないため、ここで merge。
  //   posts / fullPosts が安定参照のときは同一 object を返すので FeedPostRow の memo は保たれる。
  const { fullPosts } = useFeedPage(postIds);
  const enrichedPosts = useMemo<Post[]>(
    () =>
      posts.map((p) => {
        const full = fullPosts.get(p.id);
        if (!full) return p;
        return {
          ...p,
          avatar_url: full.avatar_url ?? null,
          avatar_emoji: full.avatar_emoji ?? null,
          pseudonym_id: full.pseudonym_id ?? null,
          ...(full.official_author ? { official_author: full.official_author } : {}),
        };
      }),
    [posts, fullPosts],
  );

  // コミュニティスタンプ機能 (community stamp reactions) は UI から撤去 (2026-05)。
  // DB 側の table / RPC は残置 — rollback の容易性のため。

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
    <View>
      {/* ソート(滑るアンダーライン) */}
      <CommunitySortTabs value={sort} onChange={onSortChange} />

      {isLoading ? (
        <View style={{ paddingVertical: SP['10'], alignItems: 'center' }}>
          <Spinner size="large" />
        </View>
      ) : posts.length === 0 ? (
        <View style={{ paddingTop: SP['10'], paddingBottom: SP['10'], paddingHorizontal: SP['5'], alignItems: 'center' }}>
          <Text style={[T.h2, { color: C.text, textAlign: 'center' }]}>まだ、静かだ。</Text>
          <Text style={[T.body, { color: C.text3, textAlign: 'center', marginTop: SP['2'] }]}>
            最初の一投が、この場所の温度になる。
          </Text>
          <PressableScale
            onPress={() =>
              router.push(`/post/create?community_id=${encodeURIComponent(communityId)}` as never)
            }
            haptic="confirm"
            style={{
              marginTop: SP['5'],
              borderWidth: 1,
              borderColor: C.border,
              borderRadius: R.full,
              paddingHorizontal: SP['5'],
              paddingVertical: 10,
            }}
          >
            <Text style={[T.smallM, { color: C.text2, fontWeight: '700' }]}>投稿する</Text>
          </PressableScale>
        </View>
      ) : (
        <View>
          {enrichedPosts.map((p) => (
            <FeedPostRow
              key={p.id}
              post={p}
              isOwn={fullPosts.get(p.id)?.is_own}
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
              onReport={setReportPostId}
            />
          ))}
        </View>
      )}
      <ReportSheet
        visible={!!reportPostId}
        postId={reportPostId}
        onClose={() => setReportPostId(null)}
      />
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
  isOwn?: boolean;
  liked: boolean;
  concerned: boolean;
  saved: boolean;
  reactions: ReactionAgg[];
  addedTags: string[];
  poll: Poll | undefined;
  toggleLike: (id: string) => void;
  toggleConcern: (id: string) => void;
  toggleSave: (id: string) => void;
  toggleReact: (id: string, meme: string) => void;
  share: (title: string, path: string) => Promise<void>;
  router: ReturnType<typeof useRouter>;
  handleAddTag: (postId: string, tag: string) => Promise<void>;
  onReport: (postId: string) => void;
};
const FeedPostRow = memo(function FeedPostRow({
  post,
  isOwn,
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
  onReport,
}: FeedPostRowProps) {
  const onLike = useCallback(() => toggleLike(post.id), [toggleLike, post.id]);
  const onConcern = useCallback(
    () => toggleConcern(post.id),
    [toggleConcern, post.id],
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
  const onMore = useCallback(() => onReport(post.id), [onReport, post.id]);
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
      isOwn={isOwn}
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
      viewContext="community"
    />
  );
});