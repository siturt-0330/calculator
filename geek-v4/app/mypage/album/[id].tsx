// ============================================================
// app/mypage/album/[id].tsx — アルバム詳細 (UI Polish Phase 2)
// ============================================================
// spec: docs/UI_POLISH_SPEC.md § 4 + docs/MYPAGE_ALBUMS_SPEC.md § 6
// - TopBar: title=album.title + BackButton + 右に編集/削除 menu (owner のみ)
// - 上部 cover 画像を Reanimated useAnimatedScrollHandler で parallax
//   - scrollY * -0.5 で逆方向に translateY (画像が遅れて流れる)
//   - pull-down (scrollY が負) で scale 1.0 ↔ 1.2 補間
// - cover に LinearGradient overlay (透明 → 暗黒) を重ねてタイトルを白で読ませる
// - 右 menu (アルバム編集 / 削除) は GlassCard 風 dropdown
// - 下に AlbumPhotoGrid (既存) を表示
// ============================================================

import { useState } from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  useWindowDimensions,
  Platform,
} from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
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
import { C, R, SP, SHADOW, isLightActive } from '../../../design/tokens';
import { T } from '../../../design/typography';
import { sanitizeUrl } from '../../../lib/sanitize';
import { isValidUuid } from '../../../lib/validation';

export default function AlbumDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  // route param を UUID validation して cache DoS を防ぐ (詳細は lib/validation.ts)
  const rawId = typeof params.id === 'string' ? params.id : '';
  const id = isValidUuid(rawId) ? rawId : null;
  const { width } = useWindowDimensions();
  const show = useToastStore((s) => s.show);
  const userId = useAuthStore((s) => s.user?.id);

  const { album, isLoading } = useAlbum(id ?? undefined);
  const { photos, isLoading: photosLoading } = useAlbumPhotos(id ?? undefined);
  const deleteAlbum = useDeleteAlbum();

  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Parallax: scrollY を共有値で持ち、cover image の transform に流す
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  // cover image の高さ (spec: min(280, width * 0.7))
  const coverHeight = Math.min(280, Math.round(width * 0.7));

  // Parallax style:
  //   - translateY = scrollY * -0.5 で画面と逆方向に半分の速度で流す
  //     (scrollY が正で上にスクロール → 画像は上に微妙にしか動かない = parallax)
  //   - scale = pull-down (scrollY が負) のときだけ 1.0 → 1.2 に膨らむ
  //     (input: [-coverHeight, 0], output: [1.2, 1.0], CLAMP で正側は 1.0 固定)
  const coverAnimStyle = useAnimatedStyle(() => {
    const translateY = scrollY.value * -0.5;
    const scale = interpolate(
      scrollY.value,
      [-coverHeight, 0],
      [1.2, 1.0],
      Extrapolation.CLAMP,
    );
    return {
      transform: [{ translateY }, { scale }],
    };
  });

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

  // route param validation 失敗 → cache 汚染を防ぐため早期 return
  if (!id) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <TopBar title="" left={<BackButton />} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: SP['6'] }}>
          <Text style={[T.body, { color: C.text2 }]}>無効な URL です</Text>
        </View>
      </View>
    );
  }

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

      {/* 右上 dropdown menu (glass-effect) — owner のみ */}
      {menuOpen && isOwner && (
        <GlassMenu top={insets.top + 52}>
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
              paddingHorizontal: SP['4'],
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
              paddingHorizontal: SP['4'],
              paddingVertical: SP['3'],
            }}
          >
            <Icon.trash size={16} color={C.red} strokeWidth={2.2} />
            <Text style={[T.smallM, { color: C.red }]}>削除</Text>
          </PressableScale>
        </GlassMenu>
      )}

      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{
          paddingBottom: insets.bottom + SP['10'],
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* ===== Parallax Cover ===== */}
        <View
          style={{
            width: '100%',
            height: coverHeight,
            backgroundColor: C.bg3,
            overflow: 'hidden',
          }}
        >
          {/* Animated image layer */}
          <Animated.View
            style={[
              {
                position: 'absolute',
                left: 0,
                right: 0,
                top: 0,
                height: coverHeight,
              },
              coverAnimStyle,
            ]}
          >
            {safeCover ? (
              <Image
                source={{ uri: safeCover }}
                style={{ width: '100%', height: '100%' }}
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={200}
              />
            ) : (
              <View
                style={{
                  flex: 1,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: C.bg3,
                }}
              >
                <Icon.image size={48} color={C.text3} strokeWidth={1.6} />
              </View>
            )}
          </Animated.View>

          {/* Gradient overlay (上は透明 → 下は黒) — タイトルが読めるように */}
          <LinearGradient
            colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.15)', 'rgba(0,0,0,0.65)']}
            locations={[0, 0.55, 1]}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: 0,
              bottom: 0,
            }}
            pointerEvents="none"
          />

          {/* Cover 上に重ねる title + chips */}
          <View
            pointerEvents="box-none"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              padding: SP['4'],
              gap: SP['2'],
            }}
          >
            <Text
              style={[
                T.h1,
                {
                  color: '#fff',
                  fontWeight: '800',
                  // text に subtle drop shadow を入れて image の明部でも読める
                  textShadowColor: 'rgba(0,0,0,0.55)',
                  textShadowOffset: { width: 0, height: 2 },
                  textShadowRadius: 6,
                },
              ]}
              numberOfLines={2}
            >
              {album.title}
            </Text>

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: SP['2'],
                flexWrap: 'wrap',
              }}
            >
              {/* photo_count chip */}
              <CoverChip>
                <Text style={{ fontSize: 12, color: '#fff' }}>📷</Text>
                <Text
                  style={[
                    T.caption,
                    { color: '#fff', fontWeight: '700' },
                  ]}
                >
                  {album.photo_count} 枚
                </Text>
              </CoverChip>

              {/* visibility chip */}
              <CoverChip
                tint={isShared ? 'accent' : 'default'}
              >
                <Text style={{ fontSize: 12, color: '#fff' }}>
                  {isShared ? '👥' : '🔒'}
                </Text>
                <Text
                  style={[
                    T.caption,
                    { color: '#fff', fontWeight: '700' },
                  ]}
                >
                  {isShared ? `共有 (${sharedCount})` : '自分だけ'}
                </Text>
              </CoverChip>
            </View>
          </View>
        </View>

        {/* ===== Meta セクション (description + add CTA) ===== */}
        <View style={{ padding: SP['4'], gap: SP['3'] }}>
          {album.description ? (
            <Text style={[T.body, { color: C.text2, lineHeight: 22 }]}>
              {album.description}
            </Text>
          ) : null}

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

        {/* ===== 写真 grid ===== */}
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
      </Animated.ScrollView>

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

// ============================================================
// CoverChip — cover 上に floating する半透明 chip
// ============================================================
function CoverChip({
  children,
  tint = 'default',
}: {
  children: React.ReactNode;
  tint?: 'default' | 'accent';
}) {
  const bg = tint === 'accent' ? 'rgba(124,106,247,0.85)' : 'rgba(0,0,0,0.45)';
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: SP['2'] + 2,
        paddingVertical: 4,
        borderRadius: R.full,
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.22)',
      }}
    >
      {children}
    </View>
  );
}

// ============================================================
// GlassMenu — 右上 dropdown を BlurView (native) / rgba (web) で描く
// ============================================================
function GlassMenu({
  children,
  top,
}: {
  children: React.ReactNode;
  top: number;
}) {
  const containerStyle = {
    position: 'absolute' as const,
    top,
    right: SP['3'],
    zIndex: 100,
    borderRadius: R.lg,
    borderWidth: 1,
    borderColor: C.border,
    overflow: 'hidden' as const,
    minWidth: 180,
    ...SHADOW.md,
  };

  // ライトテーマでは dark glass が白背景で沈むので、theme-aware な C.bg2 surface に切替。
  const light = isLightActive();

  if (Platform.OS === 'web' || light) {
    return (
      <View
        style={[
          containerStyle,
          { backgroundColor: C.bg2 },
        ]}
      >
        {children}
      </View>
    );
  }

  return (
    <BlurView intensity={40} tint="dark" style={containerStyle}>
      <View style={{ backgroundColor: 'rgba(20,20,22,0.4)' }}>{children}</View>
    </BlurView>
  );
}
