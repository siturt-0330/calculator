// ============================================================
// app/mypage/photo/[id].tsx — 写真詳細 + 編集
// ============================================================
// spec: docs/MYPAGE_ALBUMS_SPEC.md § 6
// - TopBar (title=「写真」 + BackButton)
// - フル画面 image (aspect ratio 維持)
// - 下にフォーム:
//   - caption Input (multiline, 編集可能)
//   - アルバム名 (タップで変更は Phase 2 — 現状は表示のみ)
//   - visibility SegmentedControl (private | shared)
//   - shared 時: 共有相手選択 (friends checkbox 形式)
//   - 「非表示にする」 toggle
// - 「保存」 Button + 「削除」 destructive Button
// - 保存: useUpdatePhoto({ caption, visibility, shared_with_user_ids, is_hidden })
// - 削除: ConfirmDialog → useDeletePhoto → router.back()
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
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TopBar } from '../../../components/nav/TopBar';
import { BackButton } from '../../../components/nav/BackButton';
import { Input } from '../../../components/ui/Input';
import { Button } from '../../../components/ui/Button';
import { PressableScale } from '../../../components/ui/PressableScale';
import { Toggle } from '../../../components/ui/Toggle';
import { SegmentedControl } from '../../../components/ui/SegmentedControl';
import { Avatar } from '../../../components/ui/Avatar';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { fetchPhoto, fetchAlbum } from '../../../lib/api/albums';
import { useUpdatePhoto, useDeletePhoto } from '../../../hooks/useAlbums';
import { useMyFriends } from '../../../hooks/useFriends';
import { useToastStore } from '../../../stores/toastStore';
import { Icon } from '../../../constants/icons';
import { C, R, SP } from '../../../design/tokens';
import { T } from '../../../design/typography';
import { sanitizeUrl } from '../../../lib/sanitize';
import type { PhotoVisibility } from '../../../types/models';

// fetchPhoto は lib/api/albums から直接 import — useAlbums には個別 photo の
// hook が無いので、ここで useQuery(['photo', id], fetchPhoto) を組む。
export default function PhotoDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const { width: screenWidth } = useWindowDimensions();
  const show = useToastStore((s) => s.show);

  const photoQuery = useQuery({
    queryKey: ['photo', id],
    queryFn: () => fetchPhoto(id),
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

  // photo が取得できたら 1 度だけフォーム初期化
  useEffect(() => {
    if (!hydrated && photoQuery.data) {
      const p = photoQuery.data;
      setCaption(p.caption ?? '');
      setVisibility(p.visibility);
      setSharedWith(p.shared_with_user_ids ?? []);
      setIsHidden(p.is_hidden);
      setHydrated(true);
    }
  }, [hydrated, photoQuery.data]);

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
        router.back();
      },
      onError: (e) => {
        const msg = e instanceof Error ? e.message : '削除に失敗しました';
        show(msg, 'error');
        setConfirmDeleteOpen(false);
      },
    });
  };

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
      <TopBar title="写真" left={<BackButton />} />

      <ScrollView
        contentContainerStyle={{
          paddingBottom: insets.bottom + SP['24'],
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* 画像本体 */}
        <View
          style={{
            width: imageWidth,
            height: imageHeight,
            backgroundColor: '#000',
          }}
        >
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
        </View>

        {/* フォームセクション */}
        <View style={{ padding: SP['4'], gap: SP['5'] }}>
          {/* キャプション */}
          <View style={{ gap: SP['2'] }}>
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
            />
          </View>

          {/* アルバム名 (Phase 1: 表示のみ) */}
          <View style={{ gap: SP['2'] }}>
            <Text style={[T.smallB, { color: C.text2 }]}>アルバム</Text>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: SP['2'],
                paddingHorizontal: SP['3'],
                paddingVertical: SP['3'],
                backgroundColor: C.bg2,
                borderRadius: R.md,
                borderWidth: 1,
                borderColor: C.border,
              }}
            >
              <Icon.image size={18} color={C.text3} strokeWidth={2} />
              <Text style={[T.body, { color: C.text2, flex: 1 }]} numberOfLines={1}>
                {albumIdForPhoto
                  ? albumQuery.data?.title ?? 'アルバム情報を読み込み中…'
                  : '単独写真 (アルバムなし)'}
              </Text>
            </View>
          </View>

          {/* visibility */}
          <View style={{ gap: SP['2'] }}>
            <Text style={[T.smallB, { color: C.text2 }]}>公開範囲</Text>
            <SegmentedControl<PhotoVisibility>
              options={[
                { value: 'private', label: '🔒 自分だけ' },
                { value: 'shared', label: '👥 共有' },
              ]}
              value={visibility}
              onChange={setVisibility}
            />
          </View>

          {/* 共有相手選択 (shared のみ) */}
          {visibility === 'shared' && (
            <View style={{ gap: SP['2'] }}>
              <Text style={[T.smallB, { color: C.text2 }]}>共有する友達</Text>
              {friends.length === 0 ? (
                <View
                  style={{
                    padding: SP['4'],
                    backgroundColor: C.bg2,
                    borderRadius: R.md,
                    borderWidth: 1,
                    borderColor: C.border,
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
                    backgroundColor: C.bg2,
                    borderRadius: R.md,
                    borderWidth: 1,
                    borderColor: C.border,
                    overflow: 'hidden',
                  }}
                >
                  {friends.map((f, idx) => {
                    const uid = f.friend_profile.id;
                    const selected = sharedWith.includes(uid);
                    const name = f.friend_profile.nickname ?? '名無しさん';
                    return (
                      <PressableScale
                        key={f.id}
                        onPress={() => toggleSharedUser(uid)}
                        haptic="tap"
                        scaleValue={0.99}
                        accessibilityLabel={`${name} を共有相手に${selected ? '解除' : '追加'}`}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: SP['3'],
                          paddingHorizontal: SP['3'],
                          paddingVertical: SP['3'],
                          backgroundColor: selected ? C.accent + '15' : 'transparent',
                          borderTopWidth: idx === 0 ? 0 : 1,
                          borderTopColor: C.divider,
                        }}
                      >
                        <Avatar
                          size={32}
                          uri={f.friend_profile.avatar_url ?? undefined}
                          name={name}
                          emoji={f.friend_profile.avatar_emoji ?? undefined}
                        />
                        <Text
                          style={[T.bodyMd, { color: C.text, flex: 1 }]}
                          numberOfLines={1}
                        >
                          {name}
                        </Text>
                        <View
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: 11,
                            borderWidth: selected ? 0 : 1.5,
                            borderColor: C.border2,
                            backgroundColor: selected ? C.accent : 'transparent',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {selected && (
                            <Icon.ok size={14} color="#fff" strokeWidth={2.8} />
                          )}
                        </View>
                      </PressableScale>
                    );
                  })}
                </View>
              )}
              {friends.length > 0 && (
                <Text style={[T.caption, { color: C.text3 }]}>
                  選択中: {sharedWith.length} / {friends.length} 人
                </Text>
              )}
            </View>
          )}

          {/* 非表示トグル */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: SP['3'],
              padding: SP['4'],
              borderRadius: R.lg,
              backgroundColor: C.bg3,
              borderWidth: 1,
              borderColor: C.border,
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

          {/* 保存ボタン */}
          <Button
            label={updatePhoto.isPending ? '保存中…' : '保存'}
            onPress={handleSave}
            variant="primary"
            size="lg"
            fullWidth
            loading={updatePhoto.isPending}
            disabled={isSubmitting || !hasChanges}
            haptic="confirm"
          />

          {/* 削除ボタン */}
          <Button
            label="この写真を削除"
            onPress={() => setConfirmDeleteOpen(true)}
            variant="danger"
            size="md"
            fullWidth
            disabled={isSubmitting}
            haptic="warn"
            icon={Icon.trash}
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
