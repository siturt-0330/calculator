import { useCallback, useState } from 'react';
import { View, Text, ScrollView, Image, RefreshControl } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react-native';
import { useAuthStore } from '../../stores/authStore';
import { useNotifications } from '../../hooks/useNotifications';
import { useMyFriends } from '../../hooks/useFriends';
import { supabase } from '../../lib/supabase';
import { fetchMyCommunities, type Community } from '../../lib/api/communities';
import { fetchMyPhotos } from '../../lib/api/albums';
import { sanitizeUrl } from '../../lib/sanitize';
import { computeTrustBreakdown } from '../../lib/trust/score';
import { PressableScale } from '../../components/ui/PressableScale';
import { NotificationBadge } from '../../components/ui/NotificationBadge';
import { MypageSkeleton } from '../../components/ui/Skeleton';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { GlassCard } from '../../components/ui/GlassCard';
import { PolishedButton } from '../../components/ui/PolishedButton';
import { AlbumPhotoGrid } from '../../components/mypage/AlbumPhotoGrid';
import { EmptyAlbums } from '../../components/mypage/EmptyAlbums';
import { HeroAvatar } from '../../components/mypage/HeroAvatar';
import { Icon } from '../../constants/icons';
import { C, R, SP, SHADOW, GRAD } from '../../design/tokens';
import { T } from '../../design/typography';
import { TABBAR } from '../../design/tabbar';
import type { AlbumPhoto } from '../../types/models';

type MypageStats = {
  post_count: number;
  like_received_count: number;
  comment_count: number;
  concern_received_count: number;
  created_at: string | null;
  nickname: string | null;
  avatar_emoji: string | null;
  avatar_url: string | null;
};

type AlbumScope = 'mine' | 'shared' | 'all';

export default function MypageScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // selector: 全 destructure → 必要フィールドのみ subscribe (account_state 等の他フィールド更新で
  // re-render するのを防ぐ)
  const user = useAuthStore((s) => s.user);
  const { unreadCount } = useNotifications();
  const qc = useQueryClient();
  const [albumScope, setAlbumScope] = useState<AlbumScope>('all');
  // Pull-to-refresh state — mypage 主要 query (stats / albums / friends / communities) を一括再 fetch.
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      // broad invalidate — feed-page と異なり数十 query しかない & UX 上 staleness が見えやすい画面なので
      // 該当 prefix を順次叩くより queryKey の先頭 1 個で広めに invalidate する。
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['mypage-stats'] }),
        qc.invalidateQueries({ queryKey: ['mypage-my-communities'] }),
        qc.invalidateQueries({ queryKey: ['album-photos'] }),
        qc.invalidateQueries({ queryKey: ['friends'] }),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [qc, refreshing]);

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['mypage-stats', user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase
        .from('profiles')
        .select('post_count, like_received_count, comment_count, concern_received_count, created_at, nickname, avatar_emoji, avatar_url')
        .eq('id', user.id)
        .single();
      return data as MypageStats | null;
    },
    enabled: !!user,
    // 自分の集計値はほぼ stale OK — 1 分は再 fetch しない
    staleTime: 60_000,
  });

  const { data: myCommunities = [] } = useQuery<Community[]>({
    queryKey: ['mypage-my-communities', user?.id],
    queryFn: fetchMyCommunities,
    enabled: !!user,
    staleTime: 60_000,
  });

  // 友達一覧 — count を Hero アクション boxes の badge に出す
  // spec § 5 (hooks/useFriends.ts) — useMyFriends() は accepted のみ返す
  const { friends } = useMyFriends();
  const friendCount = friends.length;

  // アルバム/写真一覧 — segmented control の scope に応じて切替
  // spec § 4.2 (lib/api/albums.ts) — fetchMyPhotos(scope) は owner=self 視点で
  // visibility で絞った AlbumPhoto[] を返す。
  // queryKey は M2 (hooks/useAlbums.ts) と一貫させるため ['album-photos', scope, userId]。
  const { data: photos = [], isLoading: photosLoading } = useQuery<AlbumPhoto[]>({
    queryKey: ['album-photos', albumScope, user?.id ?? 'anon'],
    queryFn: () => fetchMyPhotos(albumScope),
    enabled: !!user,
    staleTime: 30_000,
  });

  const accountAge = user?.created_at
    ? Math.floor((Date.now() - new Date(user.created_at).getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  // 信用スコア: tier + 現在値を mypage の Row に表示
  const trust = computeTrustBreakdown({
    post_count: stats?.post_count ?? 0,
    like_received_count: stats?.like_received_count ?? 0,
    comment_count: stats?.comment_count ?? 0,
    concern_received_count: stats?.concern_received_count ?? 0,
    created_at: stats?.created_at ?? user?.created_at ?? null,
  });

  if (statsLoading && !stats) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
        <MypageSkeleton />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingBottom: TABBAR.height + insets.bottom + SP['10'],
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={C.accent}
            colors={[C.accent]}
          />
        }
      >
        {/* ───────── 上部: アイコン2つだけのミニマルバー ───────── */}
        <View
          style={{
            paddingTop: insets.top + SP['2'],
            paddingHorizontal: SP['4'],
            paddingBottom: SP['1'],
            flexDirection: 'row',
            justifyContent: 'flex-end',
            gap: SP['1'],
          }}
        >
          <IconButton
            icon={Icon.bell}
            badge={unreadCount}
            onPress={() => router.push('/notifications' as never)}
          />
          <IconButton
            icon={Icon.settings}
            onPress={() => router.push('/settings' as never)}
          />
        </View>

        {/* ───────── Hero card — 上半分グラデ / 下半分 Glass の 2 段構成 ───────── */}
        <PolishedHero
          nickname={stats?.nickname ?? user?.nickname ?? 'ユーザー'}
          accountAge={accountAge}
          tier={trust.tier}
          avatarUrl={stats?.avatar_url}
          avatarEmoji={stats?.avatar_emoji}
          friendCount={friendCount}
          onEditPress={() => router.push('/settings/profile-edit' as never)}
          onFriendsPress={() => router.push('/mypage/friends' as never)}
        />

        {/* ───────── プライマリアクション 2 つ ───────── */}
        <View
          style={{
            flexDirection: 'row',
            marginTop: SP['4'],
            marginHorizontal: SP['4'],
            gap: SP['2'],
          }}
        >
          <PrimaryAction
            icon={Icon.post}
            label="投稿する"
            onPress={() => router.push('/post/create' as never)}
            solid
          />
          <PrimaryAction
            icon={Icon.calendar}
            label="カレンダー"
            onPress={() => router.push('/mypage/calendar' as never)}
          />
        </View>

        {/* ───────── アルバム: 3 タブ (mine / shared / all) ───────── */}
        <AlbumsSection
          scope={albumScope}
          onScopeChange={setAlbumScope}
          photos={photos}
          isLoading={photosLoading}
          onPhotoPress={(id) => router.push(`/mypage/photo/${id}` as never)}
        />

        {/* ───────── セクション: マイコミュニティ ───────── */}
        <MyCommunitiesSection communities={myCommunities} />

        {/* アクティビティ / アカウント / プライバシー / ログアウト は 右上の歯車 (/settings)
            に集約済 — このマイページは "自分のブランド + アルバム + 友達 + コミュニティ" の
            コアだけに絞る */}
      </ScrollView>

      {/* ───────── FAB: 写真追加 (右下、TabBar の上)
           ・GRAD.warm の LinearGradient 背景 + SHADOW.glow で華やかな floating ボタンに ───────── */}
      <PressableScale
        onPress={() => router.push('/mypage/photo/add' as never)}
        haptic="confirm"
        accessibilityLabel="写真を追加"
        style={{
          position: 'absolute',
          right: SP['4'],
          bottom: insets.bottom + TABBAR.height + SP['4'],
          width: 56,
          height: 56,
          borderRadius: 28,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          ...SHADOW.glow,
          zIndex: 1000,
        }}
      >
        <LinearGradient
          colors={GRAD.warm}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
          }}
        />
        <Icon.plus size={24} color="#fff" strokeWidth={2.5} />
      </PressableScale>

    </View>
  );
}

// ───────────────────────────────────────────────────────────────
// 内部コンポーネント
// ───────────────────────────────────────────────────────────────

function IconButton({
  icon: I,
  onPress,
  badge,
}: {
  icon: LucideIcon;
  onPress: () => void;
  badge?: number;
}) {
  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      style={{
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <I size={22} color={C.text} strokeWidth={2.2} />
      {badge !== undefined && <NotificationBadge count={badge} top={4} right={4} />}
    </PressableScale>
  );
}

// ───────────────────────────────────────────────────────────────
// PolishedHero — マイページ Hero card
//   上半分: GRAD.primary 背景に HeroAvatar (gradient ring) + nickname + tier pill
//   下半分: アクション 2 ボタン (プロフィール編集 / 友達追加)
//   ※ 旧仕様の bio (自慢集) 表示は削除. プロフィール編集画面で設定する.
// ───────────────────────────────────────────────────────────────
function PolishedHero({
  nickname,
  accountAge,
  tier,
  avatarUrl,
  avatarEmoji,
  friendCount,
  onEditPress,
  onFriendsPress,
}: {
  nickname: string;
  accountAge: number;
  tier: { name: string; emoji: string; color: string };
  avatarUrl: string | null | undefined;
  avatarEmoji: string | null | undefined;
  friendCount: number;
  onEditPress: () => void;
  onFriendsPress: () => void;
}) {
  return (
    <View
      style={{
        marginTop: SP['2'],
        marginHorizontal: SP['4'],
        borderRadius: R.xl,
        overflow: 'hidden',
        ...SHADOW.md,
      }}
    >
      {/* 上半分: グラデ背景 */}
      <LinearGradient
        colors={GRAD.primary}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          alignItems: 'center',
          paddingTop: SP['6'],
          paddingBottom: SP['5'],
          paddingHorizontal: SP['4'],
          gap: SP['3'],
        }}
      >
        <HeroAvatar
          size={96}
          avatarUrl={avatarUrl}
          avatarEmoji={avatarEmoji}
          nickname={nickname}
        />
        <Text
          style={[T.h2, { color: '#fff', textAlign: 'center', marginTop: SP['1'] }]}
          numberOfLines={1}
        >
          {nickname}
        </Text>
        {/* trust score / status を chip 風 pill で表示 */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: SP['3'],
            paddingVertical: 4,
            borderRadius: R.full,
            backgroundColor: 'rgba(255,255,255,0.18)',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.28)',
          }}
        >
          <Text style={{ fontSize: 13 }}>{tier.emoji}</Text>
          <Text
            style={[
              T.smallB,
              { color: '#fff', letterSpacing: 0.4, fontSize: 12 },
            ]}
          >
            {tier.name}
          </Text>
          <View
            style={{ width: 1, height: 10, backgroundColor: 'rgba(255,255,255,0.4)' }}
          />
          <Text style={[T.caption, { color: 'rgba(255,255,255,0.85)' }]}>
            {accountAge}日目
          </Text>
        </View>
      </LinearGradient>

      {/* 下半分: GlassCard 風 (rgba background) — bio + actions */}
      <View
        style={{
          backgroundColor: C.bg2,
          paddingHorizontal: SP['4'],
          paddingTop: SP['4'],
          paddingBottom: SP['4'],
          gap: SP['3'],
        }}
      >
        {/* アクション 2 ボタン: プロフィール編集 / 友達追加 */}
        <View style={{ flexDirection: 'row', gap: SP['2'] }}>
          <PolishedButton
            variant="outline"
            icon={<Icon.edit size={16} color={C.accent} strokeWidth={2.2} />}
            label="プロフィール編集"
            onPress={onEditPress}
            style={{ flex: 1 }}
            fullWidth
          />
          <PolishedButton
            variant="gradient"
            gradient="primary"
            icon={<Icon.friends size={16} color="#fff" strokeWidth={2.2} />}
            label="友達追加"
            onPress={onFriendsPress}
            style={{ flex: 1 }}
            fullWidth
            rightIcon={
              friendCount > 0 ? (
                <View
                  style={{
                    minWidth: 20,
                    paddingHorizontal: 6,
                    paddingVertical: 1,
                    borderRadius: R.full,
                    backgroundColor: 'rgba(255,255,255,0.25)',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>
                    {friendCount > 99 ? '99+' : friendCount}
                  </Text>
                </View>
              ) : null
            }
          />
        </View>
      </View>
    </View>
  );
}

function PrimaryAction({
  icon: I,
  label,
  onPress,
  solid,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  solid?: boolean;
}) {
  const bg = solid ? C.accent : C.bg2;
  const border = solid ? C.accent : C.border;
  const textColor = solid ? '#fff' : C.text;
  const iconColor = solid ? '#fff' : C.text2;
  return (
    <PressableScale
      onPress={onPress}
      haptic={solid ? 'confirm' : 'tap'}
      style={{
        flex: 1,
        backgroundColor: bg,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: border,
        paddingVertical: SP['3'],
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        // solid (= primary) のみ accent halo を付与
        ...(solid ? SHADOW.accentGlow : {}),
      }}
    >
      <I size={16} color={iconColor} strokeWidth={2.4} />
      <Text style={[T.smallB, { color: textColor }]}>{label}</Text>
    </PressableScale>
  );
}

// ───────────────────────────────────────────────────────────────
// アルバム 3 タブ section
// ───────────────────────────────────────────────────────────────
function AlbumsSection({
  scope,
  onScopeChange,
  photos,
  isLoading,
  onPhotoPress,
}: {
  scope: AlbumScope;
  onScopeChange: (s: AlbumScope) => void;
  photos: AlbumPhoto[];
  isLoading: boolean;
  onPhotoPress: (id: string) => void;
}) {
  return (
    <View style={{ marginTop: SP['6'] }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: SP['4'],
          paddingBottom: SP['2'],
          gap: SP['2'],
        }}
      >
        <Text
          style={[
            T.smallB,
            {
              color: C.text2,
              letterSpacing: 0.3,
              fontSize: 12,
              fontWeight: '700',
              flex: 1,
            },
          ]}
        >
          アルバム
        </Text>
        <Text style={[T.caption, { color: C.text4 }]}>
          {photos.length > 0 ? `${photos.length}枚` : ''}
        </Text>
      </View>

      {/* SegmentedControl: mine / shared / all — GlassCard で囲ってリッチに */}
      <View style={{ marginHorizontal: SP['4'] }}>
        <GlassCard style={{ padding: SP['1'] }}>
          <SegmentedControl<AlbumScope>
            options={[
              { value: 'all', label: 'すべて' },
              { value: 'mine', label: '自分のみ' },
              { value: 'shared', label: '共有中' },
            ]}
            value={scope}
            onChange={onScopeChange}
          />
        </GlassCard>
      </View>

      {/* photo grid or empty */}
      <View style={{ marginTop: SP['3'], marginHorizontal: SP['4'] }}>
        {photos.length === 0 && !isLoading ? (
          <EmptyAlbums scope={scope} />
        ) : (
          <AlbumPhotoGrid
            photos={photos}
            onPhotoPress={onPhotoPress}
            isLoading={isLoading}
          />
        )}
      </View>
    </View>
  );
}

// ───────────────────────────────────────────────────────────────
// マイコミュニティ: 横スクロール — タップで /community/{id}
// ───────────────────────────────────────────────────────────────
function MyCommunitiesSection({ communities }: { communities: Community[] }) {
  const router = useRouter();
  const empty = communities.length === 0;

  return (
    <View style={{ marginTop: SP['6'] }}>
      <Text
        style={[
          T.smallB,
          {
            color: C.text2,
            paddingHorizontal: SP['4'],
            paddingBottom: SP['2'],
            letterSpacing: 0.3,
            fontSize: 12,
            fontWeight: '700',
          },
        ]}
      >
        マイコミュニティ
      </Text>
      {empty ? (
        <View
          style={{
            marginHorizontal: SP['4'],
            backgroundColor: C.bg2,
            borderRadius: R.lg,
            borderWidth: 1,
            borderColor: C.border,
            paddingVertical: SP['5'],
            paddingHorizontal: SP['4'],
            alignItems: 'center',
            gap: SP['2'],
          }}
        >
          <Text style={[T.body, { color: C.text2, textAlign: 'center' }]}>
            まだ参加していません 🎯
          </Text>
          <PressableScale
            onPress={() => router.push('/community/discover' as never)}
            haptic="confirm"
            style={{
              paddingHorizontal: SP['4'],
              paddingVertical: SP['2'],
              borderRadius: R.full,
              backgroundColor: C.accent,
            }}
          >
            <Text style={[T.smallM, { color: '#fff', fontWeight: '700' }]}>
              コミュニティを探す
            </Text>
          </PressableScale>
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: SP['4'], gap: SP['3'] }}
        >
          {communities.map((c) => (
            <CommunityChip key={c.id} community={c} onPress={() => router.push(`/community/${c.id}` as never)} />
          ))}
          <PressableScale
            onPress={() => router.push('/community/discover' as never)}
            haptic="tap"
            style={{ alignItems: 'center', gap: 6, width: 64 }}
          >
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 28,
                backgroundColor: C.bg2,
                borderWidth: 1,
                borderColor: C.border,
                borderStyle: 'dashed',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon.plus size={22} color={C.text2} strokeWidth={2.2} />
            </View>
            <Text style={[T.caption, { color: C.text3, fontSize: 10 }]} numberOfLines={1}>
              探す
            </Text>
          </PressableScale>
        </ScrollView>
      )}
    </View>
  );
}

function CommunityChip({ community, onPress }: { community: Community; onPress: () => void }) {
  const safeIconUrl = community.icon_url ? sanitizeUrl(community.icon_url) : null;
  return (
    <PressableScale onPress={onPress} haptic="tap" style={{ alignItems: 'center', gap: 6, width: 64 }}>
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: safeIconUrl ? C.bg3 : community.icon_color,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: C.border,
        }}
      >
        {safeIconUrl ? (
          <Image source={{ uri: safeIconUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        ) : (
          <Text style={{ fontSize: 28 }}>{community.icon_emoji}</Text>
        )}
      </View>
      <Text style={[T.caption, { color: C.text2, fontSize: 10 }]} numberOfLines={1}>
        {community.name}
      </Text>
    </PressableScale>
  );
}

