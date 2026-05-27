import { useCallback, useState } from 'react';
import { View, Text, ScrollView, RefreshControl } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react-native';
import { useAuthStore } from '../../stores/authStore';
import { useNotifications } from '../../hooks/useNotifications';
import { useMyFriends } from '../../hooks/useFriends';
import { supabase } from '../../lib/supabase';
import { fetchMyPhotos } from '../../lib/api/albums';
import { PressableScale } from '../../components/ui/PressableScale';
import { NotificationBadge } from '../../components/ui/NotificationBadge';
import { MypageSkeleton } from '../../components/ui/Skeleton';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { GlassCard } from '../../components/ui/GlassCard';
import { PolishedButton } from '../../components/ui/PolishedButton';
import { AlbumPhotoGrid } from '../../components/mypage/AlbumPhotoGrid';
import { EmptyAlbums } from '../../components/mypage/EmptyAlbums';
import { HeroAvatar } from '../../components/mypage/HeroAvatar';
import { AccountStateCard } from '../../components/mypage/AccountStateCard';
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
          avatarUrl={stats?.avatar_url}
          avatarEmoji={stats?.avatar_emoji}
          friendCount={friendCount}
          onEditPress={() => router.push('/settings/profile-edit' as never)}
          onFriendsPress={() => router.push('/mypage/friends' as never)}
        />

        {/* ───────── アカウント制限の透明性 Card (Reddit ガイド #11)
             account_state が 'healthy' のときは null render. 影響なし. ───────── */}
        <AccountStateCard />

        {/* ───────── アルバム: 3 タブ (mine / shared / all) ───────── */}
        <AlbumsSection
          scope={albumScope}
          onScopeChange={setAlbumScope}
          photos={photos}
          isLoading={photosLoading}
          onPhotoPress={(id) => router.push(`/mypage/photo/${id}` as never)}
        />

        {/* 投稿する / カレンダー / マイコミュニティ / アクティビティ / アカウント / プライバシー /
            ログアウト は 右上歯車 (/settings) に集約. このマイページは "Hero + アルバム + 友達 +
            写真追加" のコアだけに絞る */}
      </ScrollView>

      {/* ───────── FAB: 写真追加 (右下、TabBar の上)
           ・「赤オレンジの丸」が何のボタンか分かりづらかったため、テキスト + plus icon の
             pill 形状 に変更. accent 色 (Geek の紫) で brand との一貫性も向上 ───────── */}
      <PressableScale
        onPress={() => router.push('/mypage/photo/add' as never)}
        haptic="confirm"
        accessibilityLabel="写真を追加"
        style={{
          position: 'absolute',
          right: SP['4'],
          bottom: insets.bottom + TABBAR.height + SP['4'],
          height: 52,
          paddingHorizontal: SP['5'],
          borderRadius: 26,
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['2'],
          overflow: 'hidden',
          ...SHADOW.glow,
          zIndex: 1000,
        }}
      >
        <LinearGradient
          colors={GRAD.primary}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
          }}
        />
        <Icon.plus size={20} color="#fff" strokeWidth={2.6} />
        <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700', letterSpacing: 0.3 }}>
          写真を追加
        </Text>
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
//   上半分: GRAD.primary 背景に HeroAvatar (gradient ring) + nickname
//   下半分: アクション 2 ボタン (プロフィール編集 / 友達追加)
//   ※ 旧仕様の bio / 信頼度 tier pill 表示は削除.
// ───────────────────────────────────────────────────────────────
function PolishedHero({
  nickname,
  avatarUrl,
  avatarEmoji,
  friendCount,
  onEditPress,
  onFriendsPress,
}: {
  nickname: string;
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

