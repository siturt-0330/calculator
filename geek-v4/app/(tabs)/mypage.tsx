// =============================================================================
// app/(tabs)/mypage.tsx — マイページ (カバー + アバター + 3 タブ)
// -----------------------------------------------------------------------------
// 構成:
//   1) ProfileMasthead — カバー画像 (shared 写真があれば自動採用) + 大型アバター
//      + 名前のみ (bio / 統計chip / フォローボタンは仕様で削除)
//   2) ProfileTabsBar — 3 タブ (共有 / 投稿 / 保存済み)
//   3) コンテンツ
//      - 共有  = AlbumPhoto (visibility='shared') の 3 列写真グリッド
//      - 投稿  = posts.author_id でフィルタした card リスト
//      - 保存済み = saves → posts の 2 段 fetch (自分専用)
//
// 公開範囲 (本人による切替):
//   - 共有 / 投稿 は profileVisibilityStore のフラグで「表示 / 非表示」を選べる。
//     非表示にすると他人視点 (将来) では見えなくなる。本人視点では「非公開中」
//     表示に切り替わり、内容も伏せて見せる (誤共有チェックしやすい UX)。
//   - 保存済みは自分専用 (RLS で他人は読めない)。トグル不要。
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, ScrollView, RefreshControl, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '../../stores/authStore';
import { useProfileVisibilityStore } from '../../stores/profileVisibilityStore';
import { supabase } from '../../lib/supabase';
import { fetchMyPhotos } from '../../lib/api/albums';
import { MypageSkeleton } from '../../components/ui/Skeleton';
import { AccountStateCard } from '../../components/mypage/AccountStateCard';
import { AlbumPhotoGrid } from '../../components/mypage/AlbumPhotoGrid';
import { EmptyAlbums } from '../../components/mypage/EmptyAlbums';
import { ProfileMasthead } from '../../components/mypage/ProfileMasthead';
import { ProfileTabsBar, type ProfileTabKey } from '../../components/mypage/ProfileTabsBar';
import { TabVisibilityToggle } from '../../components/mypage/TabVisibilityToggle';
import { UserPostsList } from '../../components/mypage/UserPostsList';
import { SavedPostsList } from '../../components/mypage/SavedPostsList';
import { C, SP } from '../../design/tokens';
import { TABBAR } from '../../design/tabbar';
import type { AlbumPhoto } from '../../types/models';

type MypageStats = {
  nickname: string | null;
  avatar_emoji: string | null;
  avatar_url: string | null;
};

export default function MypageScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();

  // ---- タブ state ----
  const [tab, setTab] = useState<ProfileTabKey>('shared');

  // ---- 可視性 store (本人による表示/非表示の切替) ----
  const showShared = useProfileVisibilityStore((s) => s.showShared);
  const showPosts = useProfileVisibilityStore((s) => s.showPosts);
  const setShowShared = useProfileVisibilityStore((s) => s.setShowShared);
  const setShowPosts = useProfileVisibilityStore((s) => s.setShowPosts);
  useEffect(() => {
    useProfileVisibilityStore.getState().hydrate();
  }, []);

  // ---- データ ----
  // stats — bio / 統計は仕様で削除したので、表示に必要な nickname / avatar のみ取得
  const { data: stats, isLoading: statsLoading } = useQuery<MypageStats | null>({
    queryKey: ['mypage-stats', user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase
        .from('profiles')
        .select('nickname, avatar_emoji, avatar_url')
        .eq('id', user.id)
        .single();
      return data as MypageStats | null;
    },
    enabled: !!user,
    staleTime: 60_000,
  });

  // 共有写真 (= AlbumPhoto.visibility='shared'). カバー画像にも自動採用する。
  const { data: sharedPhotos = [], isLoading: sharedLoading } = useQuery<AlbumPhoto[]>({
    queryKey: ['album-photos', 'shared', user?.id ?? 'anon'],
    queryFn: () => fetchMyPhotos('shared'),
    enabled: !!user,
    staleTime: 30_000,
  });

  // ---- カバー画像 = 最新の shared 写真 (なければ null → masthead が gradient fallback)
  const coverUri = useMemo(() => {
    if (sharedPhotos.length === 0) return null;
    const top = sharedPhotos[0];
    return top?.image_url ?? null;
  }, [sharedPhotos]);

  // ---- Pull-to-refresh ----
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['mypage-stats'] }),
        qc.invalidateQueries({ queryKey: ['album-photos'] }),
        qc.invalidateQueries({ queryKey: ['user-posts'] }),
        qc.invalidateQueries({ queryKey: ['saved-posts'] }),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [qc, refreshing]);

  // ---- スケルトン (初回ロードのみ) ----
  if (statsLoading && !stats) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
        <MypageSkeleton />
      </View>
    );
  }

  const nickname = stats?.nickname ?? user?.nickname ?? 'ユーザー';
  const handle = `@${nickname}`;

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
            progressViewOffset={insets.top + 40}
          />
        }
      >
        {/* ===== カバー + アバター + 名前 (アバター/カバー編集バッジ付き) ===== */}
        <ProfileMasthead
          nickname={nickname}
          handle={handle}
          avatarUrl={stats?.avatar_url}
          avatarEmoji={stats?.avatar_emoji}
          coverUri={coverUri}
          topInset={insets.top}
          onEditProfilePress={() => router.push('/settings/profile-edit' as never)}
          onMorePress={() => router.push('/settings' as never)}
          onAddPress={() => router.push('/post/create' as never)}
          onSearchPress={() => router.push('/(tabs)/search' as never)}
          // 本人視点なので編集導線を渡す。プロフィール編集画面でアバター/カバーを
          // 直接差し替えられる (タップで画像 picker が開く)。
          onEditAvatar={() => router.push('/settings/profile-edit' as never)}
          onEditCover={() => router.push('/settings/profile-edit' as never)}
        />

        {/* ===== AccountState (制限時のみ表示) ===== */}
        <View style={{ paddingHorizontal: SP['4'], marginTop: SP['4'] }}>
          <AccountStateCard />
        </View>

        {/* ===== 3 タブ切替バー ===== */}
        <View style={{ marginTop: SP['4'] }}>
          <ProfileTabsBar active={tab} onChange={setTab} />
        </View>

        {/* ===== タブごとのコンテンツ ===== */}
        {/* 公開/非公開トグルは「他人に見せるか」のスイッチ。本人視点では
            非公開時でも常に中身が見えるよう、中身の描画は分岐しない (UX 改善)。 */}
        {tab === 'shared' ? (
          <>
            <TabVisibilityToggle
              value={showShared}
              onChange={setShowShared}
              tabName="共有"
            />
            <View style={{ paddingHorizontal: SP['4'], paddingTop: SP['1'] }}>
              {sharedPhotos.length === 0 && !sharedLoading ? (
                <EmptyAlbums scope="shared" />
              ) : (
                <Pressable accessibilityRole="button">
                  <AlbumPhotoGrid
                    photos={sharedPhotos}
                    isLoading={sharedLoading}
                    onPhotoPress={(id) => router.push(`/mypage/photo/${id}` as never)}
                    horizontalPadding={SP['4']}
                  />
                </Pressable>
              )}
            </View>
          </>
        ) : null}

        {tab === 'posts' ? (
          <>
            <TabVisibilityToggle value={showPosts} onChange={setShowPosts} tabName="投稿" />
            <UserPostsList
              authorId={user?.id}
              emptyHint="あなたの投稿はここに表示されます"
              onCompose={() => router.push('/post/create' as never)}
            />
          </>
        ) : null}

        {tab === 'saved' ? (
          <SavedPostsList onBrowseFeed={() => router.push('/(tabs)/feed' as never)} />
        ) : null}
      </ScrollView>
    </View>
  );
}
