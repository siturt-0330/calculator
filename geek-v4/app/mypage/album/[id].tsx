// ============================================================
// app/mypage/album/[id].tsx — アルバム詳細
// ============================================================
// spec: docs/MYPAGE_ALBUMS_SPEC.md § 6
// - TopBar: title=album.title + BackButton + 右に編集/削除 menu (owner のみ)
// - cover image (album.cover_url) + 説明 (album.description)
// - visibility chip (private/shared) + 共有相手数 表示
// - 「+ 写真を追加」 button → /mypage/photo/add?albumId=<id>
// - AlbumPhotoGrid (components/mypage/AlbumPhotoGrid) で photo grid
// - right menu: 「アルバム編集」「削除」 — 削除は ConfirmDialog → useDeleteAlbum
// ============================================================

import { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopBar } from '../../../components/nav/TopBar';
import { BackButton } from '../../../components/nav/BackButton';
import { PressableScale } from '../../../components/ui/PressableScale';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { AlbumPhotoGrid } from '../../../components/mypage/AlbumPhotoGrid';
import {
  useAlbum,
  useAlbumPhotos,
  useDeleteAlbum,
} from '../../../hooks/useAlbums';
import { useAuthStore } from '../../../stores/authStore';
import { useToastStore } from '../../../stores/toastStore';
import { Icon } from '../../../constants/icons';
import { C, R, SP } from '../../../design/tokens';
import { T } from '../../../design/typography';
import { sanitizeUrl } from '../../../lib/sanitize';

export default function AlbumDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const { width } = useWindowDimensions();
  const show = useToastStore((s) => s.show);
  const userId = useAuthStore((s) => s.user?.id);

  const { album, isLoading } = useAlbum(id);
  const { photos, isLoading: photosLoading } = useAlbumPhotos(id);
  const deleteAlbum = useDeleteAlbum();

  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // owner だけが編集/削除できる (共有相手は view-only)
  const isOwner = !!album && !!userId && album.owner_id === userId;

  const goBack = () => router.back();

  const handleAddPhoto = () => {
    if (!id) return;
    router.push(`/mypage/photo/add?albumId=${encodeURIComponent(id)}` as never);
  };

  const handleDelete = () => {
    if (!id || deleteAlbum.isPending) return;
    deleteAlbum.mutate(id, {
      onSuccess: () => {
        show('アルバムを削除しました', 'success');
        setConfirmOpen(false);
        router.back();
      },
      onError: (e) => {
        const msg = e instanceof Error ? e.message : 'アルバムの削除に失敗しました';
        show(msg, 'error');
        setConfirmOpen(false);
      },
    });
  };

  // Loading state
  if (isLoading && !album) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <TopBar title="アルバム" left={<BackButton />} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={C.accent} />
        </View>
      </View>
    );
  }

  // Not found / error
  if (!album) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <TopBar title="アルバム" left={<BackButton />} />
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            padding: SP['6'],
            gap: SP['3'],
          }}
        >
          <Text style={[T.h3, { color: C.text, textAlign: 'center' }]}>
            アルバムを取得できませんでした
          </Text>
          <Text style={[T.small, { color: C.text3, textAlign: 'center' }]}>
            削除された、または権限がない可能性があります。
          </Text>
          <PressableScale
            onPress={goBack}
            haptic="tap"
            style={{
              marginTop: SP['2'],
              paddingHorizontal: SP['5'],
              paddingVertical: SP['3'],
              backgroundColor: C.bg3,
              borderRadius: R.full,
              borderWidth: 1,
              borderColor: C.border,
            }}
          >
            <Text style={[T.smallM, { color: C.text, fontWeight: '700' }]}>戻る</Text>
          </PressableScale>
        </View>
      </View>
    );
  }

  const safeCover = album.cover_url ? sanitizeUrl(album.cover_url) : null;
  const coverHeight = Math.min(280, Math.round(width * 0.55));
  const sharedCount = album.shared_with_user_ids.length;
  const isShared = album.visibility === 'shared';

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar
        title={album.title}
        left={<BackButton />}
        right={
          isOwner ? (
            <PressableScale
              onPress={() => setMenuOpen((v) => !v)}
              haptic="tap"
              hitSlop={10}
              accessibilityLabel="メニューを開く"
              style={{ padding: SP['2'] }}
            >
              <Icon.more size={22} color={C.text} strokeWidth={2.2} />
            </PressableScale>
          ) : undefined
        }
      />

      {/* 右上メニュー (簡易) — owner のみ */}
      {menuOpen && isOwner && (
        <View
          style={{
            position: 'absolute',
            top: insets.top + 52,
            right: SP['3'],
            zIndex: 100,
            backgroundColor: C.bg2,
            borderRadius: R.md,
            borderWidth: 1,
            borderColor: C.border,
            overflow: 'hidden',
            minWidth: 160,
          }}
        >
          <PressableScale
            onPress={() => {
              setMenuOpen(false);
              // Phase 1: album 編集 screen は未実装。トーストで知らせる。
              show('アルバム編集は近日公開です', 'info');
            }}
            haptic="tap"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: SP['2'],
              paddingHorizontal: SP['3'],
              paddingVertical: SP['3'],
            }}
          >
            <Icon.edit size={16} color={C.text} strokeWidth={2.2} />
            <Text style={[T.smallM, { color: C.text }]}>アルバム編集</Text>
          </PressableScale>
          <View style={{ height: 1, backgroundColor: C.divider }} />
          <PressableScale
            onPress={() => {
              setMenuOpen(false);
              setConfirmOpen(true);
            }}
            haptic="warn"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: SP['2'],
              paddingHorizontal: SP['3'],
              paddingVertical: SP['3'],
            }}
          >
            <Icon.trash size={16} color={C.red} strokeWidth={2.2} />
            <Text style={[T.smallM, { color: C.red }]}>削除</Text>
          </PressableScale>
        </View>
      )}

      <ScrollView
        contentContainerStyle={{
          paddingBottom: insets.bottom + SP['10'],
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Cover image */}
        <View
          style={{
            width: '100%',
            height: coverHeight,
            backgroundColor: C.bg3,
          }}
        >
          {safeCover ? (
            <Image
              source={{ uri: safeCover }}
              style={{ width: '100%', height: '100%' }}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={180}
            />
          ) : (
            <View
              style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon.image size={48} color={C.text3} strokeWidth={1.6} />
            </View>
          )}
        </View>

        {/* Meta セクション */}
        <View style={{ padding: SP['4'], gap: SP['3'] }}>
          <Text style={[T.h2, { color: C.text }]} numberOfLines={2}>
            {album.title}
          </Text>
          {album.description && (
            <Text style={[T.body, { color: C.text2, lineHeight: 22 }]}>
              {album.description}
            </Text>
          )}
          {/* visibility chip + 共有相手数 */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'], flexWrap: 'wrap' }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: SP['2'] + 2,
                paddingVertical: 4,
                borderRadius: R.full,
                backgroundColor: isShared ? C.accentBg : C.bg3,
                borderWidth: 1,
                borderColor: isShared ? C.accent + '55' : C.border,
              }}
            >
              <Text style={{ fontSize: 12 }}>{isShared ? '👥' : '🔒'}</Text>
              <Text
                style={[
                  T.caption,
                  { color: isShared ? C.accent : C.text2, fontWeight: '700' },
                ]}
              >
                {isShared ? '共有' : '自分だけ'}
              </Text>
            </View>
            {isShared && (
              <Text style={[T.caption, { color: C.text3 }]}>
                共有相手 {sharedCount} 人
              </Text>
            )}
            <View style={{ flex: 1 }} />
            <Text style={[T.caption, { color: C.text3 }]}>
              📷 {album.photo_count} 枚
            </Text>
          </View>

          {/* 「+ 写真を追加」 button (owner only) */}
          {isOwner && (
            <PressableScale
              onPress={handleAddPhoto}
              haptic="tap"
              scaleValue={0.98}
              accessibilityLabel="このアルバムに写真を追加"
              style={{
                marginTop: SP['1'],
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                paddingVertical: SP['3'],
                borderRadius: R.md,
                backgroundColor: C.accent + '18',
                borderWidth: 1.5,
                borderColor: C.accent,
              }}
            >
              <Icon.plus size={18} color={C.accent} strokeWidth={2.4} />
              <Text style={[T.bodyB, { color: C.accent }]}>写真を追加</Text>
            </PressableScale>
          )}
        </View>

        {/* 写真 grid */}
        <View style={{ paddingHorizontal: SP['4'], gap: SP['2'] }}>
          <Text style={[T.smallB, { color: C.text2 }]}>
            写真 ({photos.length})
          </Text>
          {photos.length === 0 && !photosLoading ? (
            <View
              style={{
                padding: SP['8'],
                alignItems: 'center',
                gap: SP['2'],
                backgroundColor: C.bg2,
                borderRadius: R.lg,
                borderWidth: 1,
                borderColor: C.border,
              }}
            >
              <Icon.image size={36} color={C.text3} strokeWidth={1.6} />
              <Text style={[T.small, { color: C.text3, textAlign: 'center' }]}>
                まだ写真がありません
              </Text>
              {isOwner && (
                <Text style={[T.caption, { color: C.text3, textAlign: 'center' }]}>
                  「写真を追加」から最初の 1 枚を入れよう
                </Text>
              )}
            </View>
          ) : (
            <AlbumPhotoGrid
              photos={photos}
              onPhotoPress={(photoId) =>
                router.push(`/mypage/photo/${photoId}` as never)
              }
              isLoading={photosLoading}
            />
          )}
        </View>
      </ScrollView>

      {/* 削除確認ダイアログ */}
      <ConfirmDialog
        visible={confirmOpen}
        title="アルバムを削除しますか?"
        message={`「${album.title}」 を削除します。アルバム内の写真は単独写真として残ります。この操作は取り消せません。`}
        confirmLabel={deleteAlbum.isPending ? '削除中…' : '削除する'}
        cancelLabel="キャンセル"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </View>
  );
}
