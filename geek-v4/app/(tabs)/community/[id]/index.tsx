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
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { C, R, SP } from '../../../../design/tokens';
import { T } from '../../../../design/typography';
import { Spinner } from '../../../../components/ui/Spinner';
import { TABBAR } from '../../../../design/tabbar';
import { PressableScale } from '../../../../components/ui/PressableScale';
import { EmptyState } from '../../../../components/ui/EmptyState';
import { BackButton } from '../../../../components/nav/BackButton';
import { Icon } from '../../../../constants/icons';
import { CommunityIcon } from '../../../../components/ui/CommunityIcon';
import { AnonPostCard } from '../../../../components/feed/AnonPostCard';
import { OfficialBadge } from '../../../../components/community/OfficialBadge';
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
import { sanitizeUrl } from '../../../../lib/sanitize';
import type { Post } from '../../../../types/models';
import type { ReactionAgg } from '../../../../lib/api/reactions';
import type { Poll } from '../../../../lib/api/polls';

// ============================================================
// Types
// ============================================================
// タブ構成は lib/community/tabSets.ts に集約 (genre 別 + 公式コミュ別の決定論)。
// 本ファイルは活動状態 (activeTab / visitedTabs) と panel 表示制御だけを担う。
type TabKey = CommunityTabKey;
type FeedSort = 'new' | 'top' | 'old';


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
  // 画像は contain で「拡大して切れる」を防ぎ、onError で「空白の丸」を防ぐ
  // (icon_url 失敗時は emoji へ自動 fallback)。CommunityIcon に集約。
  const safeIconUrl = icon_url ? sanitizeUrl(icon_url) : null;
  return (
    <CommunityIcon
      size={size}
      iconUrl={safeIconUrl}
      iconEmoji={icon_emoji}
      iconColor={icon_color}
    />
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
            Reddit 風 hero header — 横並びレイアウト
            avatar (small, left) → name + stats (middle) → join CTA (right)
            その下に説明文 + tags + ジャンル chip を compact に出す。
            旧版の中央集権 (avatar 大 + 中央寄せ name + 中央 stats) は廃止。
            ============================================================ */}
        <View
          style={{
            backgroundColor: C.bg2,
            paddingHorizontal: SP['4'],
            paddingTop: SP['3'],
            paddingBottom: SP['3'],
            gap: SP['3'],
          }}
        >
          {/* Row: avatar | name+stats | join button */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: SP['3'],
            }}
          >
            <CommunityAvatar
              icon_url={community.icon_url}
              icon_emoji={community.icon_emoji}
              icon_color={community.icon_color}
              size={56}
            />
            <View style={{ flex: 1, gap: 2 }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  flexWrap: 'wrap',
                }}
              >
                <Text
                  style={[T.h3, { color: C.text, fontWeight: '700' }]}
                  numberOfLines={1}
                >
                  {community.name}
                </Text>
                {community.is_official && <OfficialBadge size="sm" />}
              </View>
              <Text
                style={[T.caption, { color: C.text3 }]}
                numberOfLines={1}
              >
                {handle ? `@${handle} · ` : ''}
                {community.member_count.toLocaleString('ja-JP')} メンバー · {community.post_count.toLocaleString('ja-JP')} 投稿
              </Text>
            </View>
            <CompactSubscribeButton
              isMember={community.is_member}
              isRequestVisibility={community.visibility === 'request'}
              hasPendingRequest={community.has_pending_request ?? false}
              loading={joining}
              onPress={onJoinLeave}
            />
          </View>

          {/* 公式コミュの管理者名 (旧版から保留) */}
          {community.is_official && community.official_admin_display_name && (
            <Text style={[T.small, { color: C.text2 }]}>
              管理者: {community.official_admin_display_name}
              {community.official_organization ? ` · ${community.official_organization}` : ''}
            </Text>
          )}

          {/* Description — 3 行 clamp, タップで展開 */}
          {safeDesc.length > 0 && (
            <Pressable
              onPress={() => safeDesc.length > 80 && setDescExpanded((v) => !v)}
              style={{ alignSelf: 'stretch' }}
              hitSlop={6}
            >
              <Text
                style={[T.body, { color: C.text2 }]}
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
                  }}
                >
                  {descExpanded ? '閉じる' : '表示を増やす ↓'}
                </Text>
              )}
            </Pressable>
          )}

          {/* Hashtag chip (community.tags) は 2026-05 撤去 — hero を「名前 + 説明文 + 参加 CTA」だけに
              絞り視覚 noise を減らす。DB の community.tags は検索インデックス用に残置。
              ジャンル chip は F6 で既に撤去済。 */}
        </View>

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
        <FeedTab communityId={id} />
      </ScrollView>

      {/* 投稿作成 FAB は TabBar 側 (components/nav/TabBar.tsx) に一本化済み。
          TabBar の「+」は usePathname で現在のルートが /community/<id> なら
          自動で ?community_id=<id> を付けて遷移するため、ここでは独自 FAB を
          描画しない (2 つの紫「+」が重なる重複を解消)。 */}

    </View>
  );
}

// ============================================================
// CompactSubscribeButton — Reddit 風 hero の右上に置く小さい参加ボタン
// ------------------------------------------------------------
// 旧版 SubscribeButton はフル幅 (alignSelf:'stretch') で hero 全幅を占めていた。
// 横並びレイアウトに合わせて auto-width / 高さ控えめ / icon なしの compact 版。
// 参加中なら「参加中 ▾」 (chevronDown 付き — 通知設定等の dropdown ヒント)、
// 未参加なら「参加」 (request visibility なら「申請」)。
// ============================================================
function CompactSubscribeButton({
  isMember,
  isRequestVisibility,
  hasPendingRequest,
  loading,
  onPress,
}: {
  isMember: boolean;
  isRequestVisibility: boolean;
  hasPendingRequest: boolean;
  loading: boolean;
  onPress: () => void;
}) {
  // 申請中 (request 制で pending) — 承認待ちを明示し、二重申請を防ぐため非活性。
  if (!isMember && hasPendingRequest) {
    return (
      <View
        accessibilityLabel="参加申請中 — 承認待ちです"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          backgroundColor: C.accentBg,
          borderRadius: R.full,
          borderWidth: 1,
          borderColor: C.accent,
          paddingHorizontal: SP['3'],
          paddingVertical: 6,
        }}
      >
        <Text style={[T.smallM, { color: C.accent, fontWeight: '700' }]}>申請中</Text>
      </View>
    );
  }
  if (isMember) {
    return (
      <PressableScale
        onPress={onPress}
        haptic="tap"
        disabled={loading}
        accessibilityLabel="参加中 — タップで脱退 / 通知設定"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          backgroundColor: 'transparent',
          borderRadius: R.full,
          borderWidth: 1.5,
          borderColor: C.border2,
          paddingHorizontal: SP['3'],
          paddingVertical: 6,
          opacity: loading ? 0.6 : 1,
        }}
      >
        {loading ? (
          <ActivityIndicator size="small" color={C.text2} />
        ) : (
          <>
            <Text style={[T.smallM, { color: C.text2, fontWeight: '700' }]}>参加中</Text>
            <Icon.chevronD size={12} color={C.text3} strokeWidth={2.4} />
          </>
        )}
      </PressableScale>
    );
  }
  return (
    <PressableScale
      onPress={onPress}
      haptic="confirm"
      disabled={loading}
      accessibilityLabel={isRequestVisibility ? '参加申請を送る' : 'コミュニティに参加する'}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: C.accent,
        borderRadius: R.full,
        paddingHorizontal: SP['4'],
        paddingVertical: 6,
        opacity: loading ? 0.7 : 1,
      }}
    >
      {loading && <ActivityIndicator size="small" color="#fff" />}
      <Text style={[T.smallM, { color: '#fff', fontWeight: '700' }]}>
        {loading ? '…' : isRequestVisibility ? '申請' : '参加'}
      </Text>
    </PressableScale>
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
type FeedTabProps = {
  communityId: string;
};
const FeedTab = memo(function FeedTab({ communityId }: FeedTabProps) {
  const [sort, setSort] = useState<FeedSort>('new');
  const onSortChange = useCallback((s: FeedSort) => setSort(s), []);
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
  toggleConcern: (id: string) => void;
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
      viewContext="community"
    />
  );
});