// ============================================================
// app/mypage/photo/[id].tsx — 写真詳細 (Instagram post detail 風 feed-style)
// ============================================================
// ユーザー要望: 写真をタップしたら「閲覧画面」(Instagram の post detail と
// 同じ feed-style) を出す。旧版はいきなり form-base な edit UI が開いて
// いたが、 SNS の写真詳細としては不自然だった。
//
// レイアウト (上から):
//   1. TopBar (左に BackButton + 右に 3-dot menu = 編集/削除 popover)
//   2. 著者 row (avatar + nickname + 投稿日 + ピン icon を右端に)
//   3. 写真本体 (full-width, aspect ratio 維持) + 右下に send + comment icon stack
//   4. caption ("テスト" 等の本文) — 空ならセクション省略
//   5. 「コメントを追加…」 input bar (画面下固定相当 — KeyboardAvoidingView)
//
// 機能スコープ (Phase 1):
//   - 写真は閲覧のみ. 編集は menu → /mypage/photo/[id]/edit へ遷移
//   - 削除は menu → ConfirmDialog → useDeletePhoto
//   - ピン / send / comment / コメント送信は visual のみ (機能は準備中 toast)
//
// 著者情報は profiles.{ nickname, avatar_url, avatar_emoji } を fetch.
// 投稿日は date-fns ja locale の formatDistanceToNow + 絶対日付の併記で表示.
// ============================================================

import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { TopBar } from '../../../components/nav/TopBar';
import { BackButton } from '../../../components/nav/BackButton';
import { PressableScale } from '../../../components/ui/PressableScale';
import { Avatar } from '../../../components/ui/Avatar';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { fetchPhoto } from '../../../lib/api/albums';
import { useDeletePhoto } from '../../../hooks/useAlbums';
import { useAuthStore } from '../../../stores/authStore';
import { useToastStore } from '../../../stores/toastStore';
import { supabase } from '../../../lib/supabase';
import { withApiTimeout } from '../../../lib/withApiTimeout';
import { Icon } from '../../../constants/icons';
import { C, R, SP, SHADOW } from '../../../design/tokens';
import { T } from '../../../design/typography';
import { sanitizeUrl } from '../../../lib/sanitize';
import { isValidUuid } from '../../../lib/validation';

type AuthorProfile = {
  id: string;
  nickname: string | null;
  avatar_url: string | null;
  avatar_emoji: string | null;
};

// owner の profiles を取得 (author row 用)
async function fetchAuthorProfile(userId: string): Promise<AuthorProfile | null> {
  const { data, error } = await withApiTimeout(
    supabase
      .from('profiles')
      .select('id, nickname, avatar_url, avatar_emoji')
      .eq('id', userId)
      .maybeSingle(),
    'photo.fetchAuthorProfile',
    8000,
  );
  if (error) {
    console.warn('[photo] fetchAuthorProfile failed:', error.message);
    return null;
  }
  return (data ?? null) as AuthorProfile | null;
}

// 投稿日を「2026年5月19日」フォーマットで返す。
// Intl.DateTimeFormat は web / native 両方で動く (Hermes 含む)。
function formatAbsoluteDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('ja-JP', { dateStyle: 'long' }).format(d);
  } catch {
    return '';
  }
}

export default function PhotoDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  // route param を UUID validation して cache DoS を防ぐ (詳細は lib/validation.ts)
  const rawId = typeof params.id === 'string' ? params.id : '';
  const id = isValidUuid(rawId) ? rawId : null;
  const { width: screenWidth } = useWindowDimensions();
  const show = useToastStore((s) => s.show);
  const userId = useAuthStore((s) => s.user?.id);

  // 写真 (useQuery cache は edit 画面と共有)
  const photoQuery = useQuery({
    queryKey: ['photo', id],
    queryFn: () => fetchPhoto(id!),
    enabled: !!id,
    staleTime: 30_000,
  });

  // 著者プロフィール (photo.owner_id から取得)
  const ownerId = photoQuery.data?.owner_id ?? null;
  const authorQuery = useQuery({
    queryKey: ['profile-for-photo', ownerId ?? 'none'],
    queryFn: () => fetchAuthorProfile(ownerId as string),
    enabled: !!ownerId,
    staleTime: 60_000,
  });

  const deletePhoto = useDeletePhoto();

  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [commentText, setCommentText] = useState('');
  // ピン状態は phase 1 では visual only — DB 列がまだ無い (TODO 後付け)
  const [pinned, setPinned] = useState(false);

  // 画像 fade-in animation
  const imgOpacity = useSharedValue(0);
  const imgAnimStyle = useAnimatedStyle(() => ({ opacity: imgOpacity.value }));

  useEffect(() => {
    if (photoQuery.data) {
      imgOpacity.value = withTiming(1, {
        duration: 280,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
      });
    }
  }, [photoQuery.data, imgOpacity]);

  const isOwner = !!photoQuery.data && !!userId && photoQuery.data.owner_id === userId;

  const handleEdit = () => {
    if (!id) return;
    setMenuOpen(false);
    router.push(`/mypage/photo/${id}/edit` as never);
  };

  const handleDelete = () => {
    if (!id || deletePhoto.isPending) return;
    deletePhoto.mutate(id, {
      onSuccess: () => {
        show('写真を削除しました', 'success');
        setConfirmDeleteOpen(false);
        router.back();
      },
      onError: (e) => {
        const msg = e instanceof Error ? e.message : '削除に失敗しました';
        show(msg, 'error');
        setConfirmDeleteOpen(false);
      },
    });
  };

  // ----- 機能準備中 toast (Phase 1 visual-only な action 用) -----
  const notReady = () => show('コメント機能は準備中です', 'info');
  const togglePin = () => {
    setPinned((v) => !v);
    show('ピン機能は準備中です', 'info');
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

  // Loading
  if (photoQuery.isLoading && !photoQuery.data) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <TopBar title="写真" left={<BackButton />} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={C.accent} />
        </View>
      </View>
    );
  }

  if (!photoQuery.data) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <TopBar title="写真" left={<BackButton />} />
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
            写真を取得できませんでした
          </Text>
          <Text style={[T.small, { color: C.text3, textAlign: 'center' }]}>
            削除された、または権限がない可能性があります。
          </Text>
          <PressableScale
            onPress={() => router.back()}
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

  const photo = photoQuery.data;
  const safeUrl = photo.image_url ? sanitizeUrl(photo.image_url) : null;

  // 画像 aspect — width/height があれば維持、無ければ正方形扱い
  const naturalAspect =
    photo.width && photo.height && photo.width > 0 && photo.height > 0
      ? photo.width / photo.height
      : 1;
  // 縦長過ぎる写真でも収まるよう max を入れる (spec: ~600px capping)
  const maxImageHeight = Math.min(600, Math.round(screenWidth * 1.4));
  const imageWidth = screenWidth;
  let imageHeight = Math.round(imageWidth / naturalAspect);
  if (imageHeight > maxImageHeight) imageHeight = maxImageHeight;

  const author = authorQuery.data;
  const authorName = author?.nickname ?? '名無しさん';
  const absoluteDate = formatAbsoluteDate(photo.created_at);

  const BookmarkIcon = Icon.save; // Lucide Bookmark
  const SendIcon = Icon.send;
  const ChatIcon = Icon.comment; // Lucide MessageCircle
  const MoreIcon = Icon.more;

  const PinIcon = BookmarkIcon;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* シンプルな TopBar — 左に Back, 右に owner だけ 3-dot menu */}
      <TopBar
        title="写真"
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
              <MoreIcon size={22} color={C.text} strokeWidth={2.2} />
            </PressableScale>
          ) : undefined
        }
      />

      {/* 3-dot menu (popover) — owner のみ */}
      {menuOpen && isOwner && (
        <View
          style={{
            position: 'absolute',
            top: insets.top + 52,
            right: SP['3'],
            zIndex: 100,
            borderRadius: R.lg,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.14)',
            overflow: 'hidden',
            minWidth: 180,
            backgroundColor: 'rgba(20,20,22,0.95)',
            ...SHADOW.md,
          }}
        >
          <PressableScale
            onPress={handleEdit}
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
            <Text style={[T.smallM, { color: C.text }]}>編集</Text>
          </PressableScale>
          <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.08)' }} />
          <PressableScale
            onPress={() => {
              setMenuOpen(false);
              setConfirmDeleteOpen(true);
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
        </View>
      )}

      <ScrollView
        contentContainerStyle={{
          paddingBottom: insets.bottom + SP['20'],
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ===== 著者 row (画像の上) ===== */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: SP['3'],
            paddingHorizontal: SP['4'],
            paddingVertical: SP['3'],
          }}
        >
          <Avatar
            size={30}
            uri={author?.avatar_url ?? undefined}
            emoji={author?.avatar_emoji ?? undefined}
            name={authorName}
          />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[T.smallB, { color: C.text }]} numberOfLines={1}>
              {authorName}
            </Text>
            {!!absoluteDate && (
              <Text style={[T.caption, { color: C.text3 }]} numberOfLines={1}>
                {absoluteDate}
              </Text>
            )}
          </View>
          {/* ピン (お気に入り / save 的) — phase 1: visual only */}
          <PressableScale
            onPress={togglePin}
            haptic="tap"
            hitSlop={10}
            accessibilityLabel={pinned ? 'ピンを外す' : 'ピン留めする'}
            accessibilityState={{ selected: pinned }}
            style={{ padding: SP['2'] }}
          >
            <PinIcon
              size={22}
              color={pinned ? C.accent : C.text2}
              strokeWidth={pinned ? 2.6 : 2.0}
              fill={pinned ? C.accent : 'transparent'}
            />
          </PressableScale>
        </View>

        {/* ===== 写真本体 + 右下 action icon stack ===== */}
        <View style={{ width: imageWidth, position: 'relative' }}>
          <View
            style={{
              width: imageWidth,
              height: imageHeight,
              backgroundColor: '#000',
              overflow: 'hidden',
            }}
          >
            <Animated.View style={[{ width: '100%', height: '100%' }, imgAnimStyle]}>
              {safeUrl ? (
                <Image
                  source={{ uri: safeUrl }}
                  style={{ width: '100%', height: '100%' }}
                  contentFit="contain"
                  cachePolicy="memory-disk"
                  transition={180}
                  accessibilityLabel={photo.caption ?? '写真'}
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
            </Animated.View>
          </View>

          {/* 右下 floating action stack — send + comment */}
          <View
            style={{
              position: 'absolute',
              right: SP['3'],
              bottom: SP['3'],
              flexDirection: 'column',
              gap: SP['2'],
              alignItems: 'center',
            }}
            pointerEvents="box-none"
          >
            <PressableScale
              onPress={notReady}
              haptic="tap"
              hitSlop={8}
              accessibilityLabel="送る"
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: 'rgba(0,0,0,0.55)',
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.18)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <SendIcon size={20} color="#fff" strokeWidth={2.2} />
            </PressableScale>
            <PressableScale
              onPress={notReady}
              haptic="tap"
              hitSlop={8}
              accessibilityLabel="コメント"
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: 'rgba(0,0,0,0.55)',
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.18)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ChatIcon size={20} color="#fff" strokeWidth={2.2} />
            </PressableScale>
          </View>
        </View>

        {/* ===== caption (本文) — 空なら省略 ===== */}
        {!!photo.caption && (
          <View style={{ paddingHorizontal: SP['4'], paddingTop: SP['3'], paddingBottom: SP['2'] }}>
            <Text style={[T.body, { color: C.text, lineHeight: 22 }]}>
              <Text style={[T.bodyB, { color: C.text }]}>{authorName} </Text>
              {photo.caption}
            </Text>
          </View>
        )}

        {/* コメントセクションのプレースホルダ — phase 1 では空 */}
        <View
          style={{
            paddingHorizontal: SP['4'],
            paddingTop: SP['2'],
            paddingBottom: SP['4'],
          }}
        >
          <Text style={[T.caption, { color: C.text3 }]}>
            コメント機能は準備中です
          </Text>
        </View>
      </ScrollView>

      {/* ===== コメント入力 bar (画面下固定) ===== */}
      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: C.border,
          backgroundColor: C.bg2,
          paddingHorizontal: SP['3'],
          paddingTop: SP['2'],
          paddingBottom: insets.bottom + SP['2'],
          flexDirection: 'row',
          alignItems: 'flex-end',
          gap: SP['2'],
        }}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: C.bg3,
            borderRadius: R.lg,
            borderWidth: 1,
            borderColor: commentText.trim() ? C.accent : C.border,
            paddingHorizontal: SP['3'],
            paddingVertical: 6,
          }}
        >
          <TextInput
            value={commentText}
            onChangeText={setCommentText}
            placeholder="コメントを追加…"
            placeholderTextColor={C.text3}
            multiline
            maxLength={500}
            keyboardAppearance="dark"
            selectionColor={C.accent}
            style={[
              T.body,
              { color: C.text, maxHeight: 100, minHeight: 24, paddingVertical: 0 },
            ]}
          />
        </View>
        <PressableScale
          onPress={notReady}
          haptic="tap"
          accessibilityLabel="コメントを送信"
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: commentText.trim() ? C.accent : C.bg4,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 2,
            borderColor: commentText.trim() ? C.accent : C.border,
          }}
        >
          <SendIcon
            size={20}
            color={commentText.trim() ? '#fff' : C.text3}
            strokeWidth={2.4}
          />
        </PressableScale>
      </View>

      {/* 削除確認 */}
      <ConfirmDialog
        visible={confirmDeleteOpen}
        title="写真を削除しますか?"
        message="この操作は取り消せません。"
        confirmLabel={deletePhoto.isPending ? '削除中…' : '削除する'}
        cancelLabel="キャンセル"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </KeyboardAvoidingView>
  );
}
