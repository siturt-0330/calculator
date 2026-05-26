// ============================================================
// app/mypage/photo/[id]/edit.tsx — 写真編集フォーム
// ============================================================
// 旧 app/mypage/photo/[id].tsx の edit form をそのまま移植したもの。
// 詳細閲覧画面 (feed-style) を /mypage/photo/[id].tsx に置く方針への
// refactor に合わせ、編集 UI はこの sub-route に分離した。
//
// 旧仕様 (UI Polish Phase 2) の体験 (caption / album 表示 / visibility /
// 共有相手選択 / 非表示 toggle / 保存 / 削除) を保持。import path のみ調整。
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TopBar } from '../../../../components/nav/TopBar';
import { BackButton } from '../../../../components/nav/BackButton';
import { Input } from '../../../../components/ui/Input';
import { PressableScale } from '../../../../components/ui/PressableScale';
import { Toggle } from '../../../../components/ui/Toggle';
import { SegmentedControl } from '../../../../components/ui/SegmentedControl';
import { Avatar } from '../../../../components/ui/Avatar';
import { ConfirmDialog } from '../../../../components/ui/ConfirmDialog';
import { GlassCard } from '../../../../components/ui/GlassCard';
import { PolishedButton } from '../../../../components/ui/PolishedButton';
import { fetchPhoto, fetchAlbum } from '../../../../lib/api/albums';
import { useUpdatePhoto, useDeletePhoto } from '../../../../hooks/useAlbums';
import { useMyFriends } from '../../../../hooks/useFriends';
import { useToastStore } from '../../../../stores/toastStore';
import { Icon } from '../../../../constants/icons';
import { C, R, SP } from '../../../../design/tokens';
import { T } from '../../../../design/typography';
import { sanitizeUrl } from '../../../../lib/sanitize';
import { isValidUuid } from '../../../../lib/validation';
import type { PhotoVisibility } from '../../../../types/models';

export default function PhotoEditScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ id: string }>();
  // route param を UUID validation して cache DoS を防ぐ (詳細は lib/validation.ts)
  const rawId = typeof params.id === 'string' ? params.id : '';
  const id = isValidUuid(rawId) ? rawId : null;
  const { width: screenWidth } = useWindowDimensions();
  const show = useToastStore((s) => s.show);

  const photoQuery = useQuery({
    queryKey: ['photo', id],
    queryFn: () => fetchPhoto(id!),
    enabled: !!id,
    staleTime: 30_000,
  });

  // album 名を表示するため、photo.album_id があれば fetchAlbum で 1 件取得
  const albumIdForPhoto = photoQuery.data?.album_id ?? null;
  const albumQuery = useQuery({
    queryKey: ['album-name-for-photo', albumIdForPhoto ?? 'none'],
    queryFn: () => fetchAlbum(albumIdForPhoto as string),
    enabled: !!albumIdForPhoto,
    staleTime: 60_000,
  });

  const { friends } = useMyFriends();
  const updatePhoto = useUpdatePhoto();
  const deletePhoto = useDeletePhoto();

  // フォーム state — photo 取得後に初期化
  const [caption, setCaption] = useState('');
  const [visibility, setVisibility] = useState<PhotoVisibility>('private');
  const [sharedWith, setSharedWith] = useState<string[]>([]);
  const [isHidden, setIsHidden] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  // 画像 fade-in animation (mount 時に 0 → 1, 300ms)
  const imgOpacity = useSharedValue(0);
  const imgAnimStyle = useAnimatedStyle(() => ({
    opacity: imgOpacity.value,
  }));

  // photo が取得できたら 1 度だけフォーム初期化 + image fade を発火
  useEffect(() => {
    if (!hydrated && photoQuery.data) {
      const p = photoQuery.data;
      setCaption(p.caption ?? '');
      setVisibility(p.visibility);
      setSharedWith(p.shared_with_user_ids ?? []);
      setIsHidden(p.is_hidden);
      setHydrated(true);
      // image を fade-in
      imgOpacity.value = withTiming(1, {
        duration: 300,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
      });
    }
  }, [hydrated, photoQuery.data, imgOpacity]);

  // 変更検知
  const hasChanges = useMemo(() => {
    if (!hydrated || !photoQuery.data) return false;
    const p = photoQuery.data;
    if ((p.caption ?? '') !== caption) return true;
    if (p.visibility !== visibility) return true;
    if (p.is_hidden !== isHidden) return true;
    const origSet = new Set<string>(p.shared_with_user_ids ?? []);
    const newSet = new Set<string>(sharedWith);
    if (origSet.size !== newSet.size) return true;
    for (const uid of origSet) {
      if (!newSet.has(uid)) return true;
    }
    return false;
  }, [hydrated, photoQuery.data, caption, visibility, isHidden, sharedWith]);

  const toggleSharedUser = (uid: string) => {
    setSharedWith((prev) =>
      prev.includes(uid) ? prev.filter((x) => x !== uid) : [...prev, uid],
    );
  };

  const handleSave = () => {
    if (!id || updatePhoto.isPending) return;
    if (!hasChanges) {
      show('変更がありません', 'info');
      return;
    }
    // shared だが共有相手 0 人なら警告 (album shared を継承する場合もあるので warn のみ)
    if (visibility === 'shared' && sharedWith.length === 0 && !albumIdForPhoto) {
      show('共有相手が 0 人です。アルバムから共有されない限り、誰も見られません', 'warn');
    }

    const patch: Parameters<typeof updatePhoto.mutate>[0]['patch'] = {
      caption,
      visibility,
      shared_with_user_ids: sharedWith,
      is_hidden: isHidden,
    };
    updatePhoto.mutate(
      { id, patch },
      {
        onSuccess: () => {
          show('写真を更新しました', 'success');
          void qc.invalidateQueries({ queryKey: ['photo', id] });
          router.back();
        },
        onError: (e) => {
          const msg = e instanceof Error ? e.message : '更新に失敗しました';
          show(msg, 'error');
        },
      },
    );
  };

  const handleDelete = () => {
    if (!id || deletePhoto.isPending) return;
    deletePhoto.mutate(id, {
      onSuccess: () => {
        show('写真を削除しました', 'success');
        setConfirmDeleteOpen(false);
        // 詳細画面ごと消えるので 2 段戻る (edit → detail → 元の画面)
        router.back();
        router.back();
      },
      onError: (e) => {
        const msg = e instanceof Error ? e.message : '削除に失敗しました';
        show(msg, 'error');
        setConfirmDeleteOpen(false);
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

  // Loading
  if (photoQuery.isLoading && !photoQuery.data) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <TopBar title="写真を編集" left={<BackButton />} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={C.accent} />
        </View>
      </View>
    );
  }

  if (!photoQuery.data) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <TopBar title="写真を編集" left={<BackButton />} />
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

  // image の表示サイズを aspect ratio で計算 (width/height があれば aspect 維持)
  const naturalAspect =
    photo.width && photo.height && photo.width > 0 && photo.height > 0
      ? photo.width / photo.height
      : 1;
  // 縦長過ぎる写真でも画面に収まるように max height を入れる
  const maxImageHeight = Math.min(560, Math.round(screenWidth * 1.4));
  const imageWidth = screenWidth;
  let imageHeight = Math.round(imageWidth / naturalAspect);
  if (imageHeight > maxImageHeight) imageHeight = maxImageHeight;

  const isSubmitting = updatePhoto.isPending || deletePhoto.isPending;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <TopBar title="写真を編集" left={<BackButton />} />

      <ScrollView
        contentContainerStyle={{
          paddingBottom: insets.bottom + SP['24'],
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* ===== 画像本体 (fade-in) ===== */}
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

        {/* ===== フォームセクション (GlassCard 内) ===== */}
        <View style={{ padding: SP['4'], gap: SP['4'] }}>
          {/* キャプション */}
          <GlassCard style={{ gap: SP['2'] }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              <Text style={[T.smallB, { color: C.text2 }]}>キャプション</Text>
              <View style={{ flex: 1 }} />
              <Text
                style={[
                  T.caption,
                  { color: caption.length > 450 ? C.amber : C.text3 },
                ]}
              >
                {caption.length} / 500
              </Text>
            </View>
            <Input
              placeholder="この 1 枚に一言"
              value={caption}
              onChangeText={setCaption}
              multiline
              numberOfLines={3}
              maxLength={500}
              textAlignVertical="top"
              // 上品な typography: 16/24
              style={{ fontSize: 16, lineHeight: 24 }}
            />
          </GlassCard>

          {/* アルバム名 (Phase 1: 表示のみ) */}
          <GlassCard style={{ gap: SP['2'] }}>
            <Text style={[T.smallB, { color: C.text2 }]}>アルバム</Text>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: SP['2'],
                paddingHorizontal: SP['3'],
                paddingVertical: SP['3'],
                backgroundColor: 'rgba(255,255,255,0.04)',
                borderRadius: R.md,
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.08)',
              }}
            >
              <Icon.image size={18} color={C.text3} strokeWidth={2} />
              <Text style={[T.body, { color: C.text2, flex: 1 }]} numberOfLines={1}>
                {albumIdForPhoto
                  ? albumQuery.data?.title ?? 'アルバム情報を読み込み中…'
                  : '単独写真 (アルバムなし)'}
              </Text>
            </View>
          </GlassCard>

          {/* visibility — SegmentedControl を GlassCard で巻く */}
          <GlassCard style={{ gap: SP['2'] }}>
            <Text style={[T.smallB, { color: C.text2 }]}>公開範囲</Text>
            <SegmentedControl<PhotoVisibility>
              options={[
                { value: 'private', label: '🔒 自分だけ' },
                { value: 'shared', label: '👥 共有' },
              ]}
              value={visibility}
              onChange={setVisibility}
            />
          </GlassCard>

          {/* 共有相手選択 (shared のみ) — chip 風 grid */}
          {visibility === 'shared' && (
            <GlassCard style={{ gap: SP['2'] }}>
              <Text style={[T.smallB, { color: C.text2 }]}>共有する友達</Text>
              {friends.length === 0 ? (
                <View
                  style={{
                    padding: SP['4'],
                    backgroundColor: 'rgba(255,255,255,0.04)',
                    borderRadius: R.md,
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.08)',
                    alignItems: 'center',
                    gap: SP['1'],
                  }}
                >
                  <Text style={[T.small, { color: C.text3, textAlign: 'center' }]}>
                    まだ友達がいません
                  </Text>
                  <Text style={[T.caption, { color: C.text3, textAlign: 'center' }]}>
                    マイページの「友達」から招待リンクを作って共有しよう
                  </Text>
                </View>
              ) : (
                <View
                  style={{
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    gap: SP['2'],
                  }}
                >
                  {friends.map((f) => {
                    const uid = f.friend_profile.id;
                    const selected = sharedWith.includes(uid);
                    const name = f.friend_profile.nickname ?? '名無しさん';
                    return (
                      <FriendChip
                        key={f.id}
                        name={name}
                        avatarUri={f.friend_profile.avatar_url ?? undefined}
                        avatarEmoji={f.friend_profile.avatar_emoji ?? undefined}
                        selected={selected}
                        onPress={() => toggleSharedUser(uid)}
                      />
                    );
                  })}
                </View>
              )}
              {friends.length > 0 && (
                <Text style={[T.caption, { color: C.text3 }]}>
                  選択中: {sharedWith.length} / {friends.length} 人
                </Text>
              )}
            </GlassCard>
          )}

          {/* 非表示トグル */}
          <GlassCard>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: SP['3'],
              }}
            >
              <Text style={{ fontSize: 18 }}>{isHidden ? '🚫' : '👁️'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[T.bodyB, { color: C.text }]}>非表示にする</Text>
                <Text style={[T.small, { color: C.text3 }]}>
                  {isHidden
                    ? 'この写真は一覧から隠れます (自分だけ確認できます)'
                    : '通常通り一覧に表示されます'}
                </Text>
              </View>
              <Toggle value={isHidden} onChange={setIsHidden} />
            </View>
          </GlassCard>

          {/* 保存 / 削除 (PolishedButton) */}
          <PolishedButton
            label={updatePhoto.isPending ? '保存中…' : '保存'}
            onPress={handleSave}
            variant="gradient"
            gradient="primary"
            size="lg"
            fullWidth
            loading={updatePhoto.isPending}
            disabled={isSubmitting || !hasChanges}
            haptic="confirm"
          />

          <PolishedButton
            label="この写真を削除"
            onPress={() => setConfirmDeleteOpen(true)}
            variant="gradient"
            destructive
            size="md"
            fullWidth
            disabled={isSubmitting}
            haptic="warn"
            icon={<Icon.trash size={18} color="#fff" strokeWidth={2.4} />}
          />
        </View>
      </ScrollView>

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

// ============================================================
// FriendChip — 共有相手選択の chip 風 card (Avatar + nickname)
// ============================================================
function FriendChip({
  name,
  avatarUri,
  avatarEmoji,
  selected,
  onPress,
}: {
  name: string;
  avatarUri?: string;
  avatarEmoji?: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      onPress={onPress}
      haptic="select"
      scaleValue={0.95}
      accessibilityLabel={`${name} を共有相手に${selected ? '解除' : '追加'}`}
      accessibilityState={{ selected }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['2'],
        paddingHorizontal: SP['2'] + 2,
        paddingVertical: SP['2'],
        borderRadius: R.full,
        backgroundColor: selected ? C.accentBg : 'transparent',
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? C.accent : C.border,
      }}
    >
      <Avatar
        size={28}
        uri={avatarUri}
        name={name}
        emoji={avatarEmoji}
      />
      <Text
        style={[
          T.smallM,
          {
            color: selected ? C.text : C.text2,
            fontWeight: selected ? '700' : '600',
            maxWidth: 120,
          },
        ]}
        numberOfLines={1}
      >
        {name}
      </Text>
      {selected && (
        <Icon.ok size={14} color={C.accent} strokeWidth={2.8} />
      )}
    </PressableScale>
  );
}
