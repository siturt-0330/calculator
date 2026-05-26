// ============================================================
// app/mypage/photo/add.tsx — 写真追加 flow
// ============================================================
// spec: docs/MYPAGE_ALBUMS_SPEC.md § 6
// - searchParam で albumId (任意) を受け取る. 無ければ単独写真.
// - 画面 mount で即 ImagePicker.launchImageLibraryAsync を呼ぶ
// - 写真は正方形 crop しない (思い出写真は縦長/横長が多い) — openCropper を skip
// - caption 入力 / album 選択 (albumId 未指定なら) / visibility / 共有相手
// - 「アップロード」 → useUploadPhoto → success toast → router.back()
// - cancel → router.back()
//
// 画像 upload は必ず prepareImageUpload 経由 (CLAUDE.md § 5.9 / spec § 4)。
// useUploadPhoto の mutationFn 内で prepareImageUpload を call しているので、
// 画面側は asset.uri を直接渡す。
// ============================================================

import { useEffect, useRef, useState } from 'react';
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
import * as ImagePicker from 'expo-image-picker';
import { TopBar } from '../../../components/nav/TopBar';
import { BackButton } from '../../../components/nav/BackButton';
import { Input } from '../../../components/ui/Input';
import { Button } from '../../../components/ui/Button';
import { PressableScale } from '../../../components/ui/PressableScale';
import { SegmentedControl } from '../../../components/ui/SegmentedControl';
import { Avatar } from '../../../components/ui/Avatar';
import { useMyAlbums, useUploadPhoto } from '../../../hooks/useAlbums';
import { useMyFriends } from '../../../hooks/useFriends';
import { useToastStore } from '../../../stores/toastStore';
import { Icon } from '../../../constants/icons';
import { C, R, SP } from '../../../design/tokens';
import { T } from '../../../design/typography';
import type { PhotoVisibility } from '../../../types/models';

// 「新規アルバム」を表す sentinel value (uuid と被らないリテラル)
const NEW_ALBUM_SENTINEL = '__new_album__';

export default function AddPhotoScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ albumId?: string }>();
  const presetAlbumId =
    typeof params.albumId === 'string' && params.albumId.length > 0
      ? params.albumId
      : undefined;
  const { width: screenWidth } = useWindowDimensions();
  const show = useToastStore((s) => s.show);

  const { albums } = useMyAlbums();
  const { friends } = useMyFriends();
  const uploadPhoto = useUploadPhoto();

  // 選択した画像
  const [pickedUri, setPickedUri] = useState<string | null>(null);
  const [pickerOpened, setPickerOpened] = useState(false);
  const pickerInFlight = useRef(false);

  // フォーム
  const [caption, setCaption] = useState('');
  // albumId 未指定なら「どこに入れるか」 selector を出す。
  //   - NEW_ALBUM_SENTINEL: 新規アルバムを作る (Phase 1 では一旦 toast で誘導)
  //   - 空文字 or null: 単独写真 (album_id=null)
  //   - uuid: 既存 album
  const [selectedAlbumId, setSelectedAlbumId] = useState<string>('');
  const [visibility, setVisibility] = useState<PhotoVisibility>('private');
  const [sharedWith, setSharedWith] = useState<string[]>([]);

  // 初回 mount で picker を 1 度だけ立ち上げる
  useEffect(() => {
    if (pickerOpened || pickerInFlight.current) return;
    pickerInFlight.current = true;
    setPickerOpened(true);
    (async () => {
      try {
        if (Platform.OS !== 'web') {
          const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!perm.granted) {
            show('写真へのアクセス権限が必要です', 'warn');
            router.back();
            return;
          }
        }
        const r = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: 'images',
          quality: 1,
          // 写真用は正方形 crop しない (allowsEditing は使わない).
          // 思い出写真は縦長 / 横長が多く、無理に 1:1 にすると重要な被写体が
          // 切れる可能性が高い。原寸を保持して prepareImageUpload に渡す。
          allowsEditing: false,
          allowsMultipleSelection: false,
        });
        if (r.canceled || !r.assets[0]) {
          // picker キャンセル = 画面を閉じる
          router.back();
          return;
        }
        setPickedUri(r.assets[0].uri);
      } catch (e) {
        const msg = e instanceof Error ? e.message : '画像の取得に失敗しました';
        show(msg, 'error');
        router.back();
      } finally {
        pickerInFlight.current = false;
      }
    })();
    // 1 度きり mount で動かす (router/show を deps に入れると effect が再走するため)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleSharedUser = (uid: string) => {
    setSharedWith((prev) =>
      prev.includes(uid) ? prev.filter((x) => x !== uid) : [...prev, uid],
    );
  };

  const handleUpload = () => {
    if (!pickedUri || uploadPhoto.isPending) return;

    // album 選択の前処理
    let effectiveAlbumId: string | undefined = presetAlbumId;
    if (!effectiveAlbumId) {
      if (selectedAlbumId === NEW_ALBUM_SENTINEL) {
        // Phase 1: 新規アルバム作成 flow は別画面が無いので注意喚起のみ
        show('新規アルバム作成は近日公開です。単独写真として保存します', 'info');
        effectiveAlbumId = undefined;
      } else if (selectedAlbumId && selectedAlbumId.length > 0) {
        effectiveAlbumId = selectedAlbumId;
      }
    }

    // shared なのに共有相手 0 人なら 警告 (private で保存する選択肢を促す)
    if (visibility === 'shared' && sharedWith.length === 0 && !effectiveAlbumId) {
      show('共有相手が 0 人です。アルバム共有も無いので誰も見られません', 'warn');
    }

    uploadPhoto.mutate(
      {
        uri: pickedUri,
        opts: {
          albumId: effectiveAlbumId,
          caption: caption.trim() || undefined,
          visibility,
          sharedWith,
        },
      },
      {
        onSuccess: () => {
          show('写真を追加しました', 'success');
          router.back();
        },
        onError: (e) => {
          const msg = e instanceof Error ? e.message : 'アップロードに失敗しました';
          show(msg, 'error');
        },
      },
    );
  };

  const handleCancel = () => {
    if (uploadPhoto.isPending) return;
    router.back();
  };

  // ============================================================
  // 「picker からの結果待ち」状態 (mount 直後)
  // ============================================================
  if (!pickedUri) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <TopBar title="写真を追加" left={<BackButton />} />
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            gap: SP['3'],
          }}
        >
          <ActivityIndicator color={C.accent} />
          <Text style={[T.small, { color: C.text3 }]}>写真を選んでください…</Text>
        </View>
      </View>
    );
  }

  // image preview の縦横比を計算
  const previewMaxH = Math.min(360, Math.round(screenWidth * 0.8));

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <TopBar
        title="写真を追加"
        left={<BackButton onPress={handleCancel} />}
      />

      <ScrollView
        contentContainerStyle={{
          padding: SP['4'],
          paddingBottom: insets.bottom + SP['24'],
          gap: SP['5'],
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* プレビュー */}
        <View
          style={{
            width: '100%',
            height: previewMaxH,
            backgroundColor: '#000',
            borderRadius: R.lg,
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: C.border,
          }}
        >
          <Image
            source={{ uri: pickedUri }}
            style={{ width: '100%', height: '100%' }}
            contentFit="contain"
            cachePolicy="memory"
            transition={120}
          />
        </View>
        <PressableScale
          onPress={async () => {
            if (uploadPhoto.isPending) return;
            try {
              const r = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: 'images',
                quality: 1,
                allowsEditing: false,
                allowsMultipleSelection: false,
              });
              if (!r.canceled && r.assets[0]) {
                setPickedUri(r.assets[0].uri);
              }
            } catch (e) {
              const msg = e instanceof Error ? e.message : '画像の取得に失敗しました';
              show(msg, 'error');
            }
          }}
          haptic="tap"
          disabled={uploadPhoto.isPending}
          style={{
            alignSelf: 'center',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: SP['3'],
            paddingVertical: SP['2'],
            backgroundColor: C.bg3,
            borderRadius: R.full,
            borderWidth: 1,
            borderColor: C.border,
          }}
        >
          <Icon.image size={14} color={C.text2} strokeWidth={2.2} />
          <Text style={[T.captionM, { color: C.text2 }]}>別の写真を選ぶ</Text>
        </PressableScale>

        {/* キャプション */}
        <View style={{ gap: SP['2'] }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
            <Text style={[T.smallB, { color: C.text2 }]}>キャプション (任意)</Text>
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

        {/* アルバム選択 (albumId 未指定時のみ) */}
        {!presetAlbumId && (
          <View style={{ gap: SP['2'] }}>
            <Text style={[T.smallB, { color: C.text2 }]}>どこに入れる?</Text>
            <View
              style={{
                backgroundColor: C.bg2,
                borderRadius: R.md,
                borderWidth: 1,
                borderColor: C.border,
                overflow: 'hidden',
              }}
            >
              {/* 単独写真 */}
              <AlbumOption
                label="単独写真 (アルバムなし)"
                emoji="🖼️"
                selected={selectedAlbumId === ''}
                onPress={() => setSelectedAlbumId('')}
                first
              />
              {/* 既存 album */}
              {albums.map((a) => (
                <AlbumOption
                  key={a.id}
                  label={a.title}
                  sub={`📷 ${a.photo_count} 枚`}
                  emoji={a.visibility === 'shared' ? '👥' : '🔒'}
                  selected={selectedAlbumId === a.id}
                  onPress={() => setSelectedAlbumId(a.id)}
                />
              ))}
              {/* 新規 album 作成 (Phase 1: toast 誘導) */}
              <AlbumOption
                label="新規アルバムを作る"
                sub="(近日公開)"
                emoji="➕"
                selected={selectedAlbumId === NEW_ALBUM_SENTINEL}
                onPress={() => setSelectedAlbumId(NEW_ALBUM_SENTINEL)}
                accent
              />
            </View>
          </View>
        )}
        {presetAlbumId && (
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
            <Text style={{ fontSize: 14 }}>📂</Text>
            <Text style={[T.small, { color: C.text2 }]}>
              指定されたアルバムに追加されます
            </Text>
          </View>
        )}

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

        {/* 共有相手 (shared のみ) */}
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
          </View>
        )}

        {/* CTA */}
        <View style={{ gap: SP['2'] }}>
          <Button
            label={uploadPhoto.isPending ? 'アップロード中…' : 'アップロード'}
            onPress={handleUpload}
            variant="primary"
            size="lg"
            fullWidth
            loading={uploadPhoto.isPending}
            disabled={uploadPhoto.isPending || !pickedUri}
            haptic="confirm"
          />
          <Button
            label="キャンセル"
            onPress={handleCancel}
            variant="ghost"
            size="md"
            fullWidth
            disabled={uploadPhoto.isPending}
            haptic="tap"
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ============================================================
// AlbumOption — アルバム選択行 (リスト内 1 行)
// ============================================================
function AlbumOption({
  label,
  sub,
  emoji,
  selected,
  onPress,
  first,
  accent,
}: {
  label: string;
  sub?: string;
  emoji: string;
  selected: boolean;
  onPress: () => void;
  first?: boolean;
  accent?: boolean;
}) {
  return (
    <PressableScale
      onPress={onPress}
      haptic="select"
      scaleValue={0.99}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['3'],
        paddingHorizontal: SP['3'],
        paddingVertical: SP['3'],
        backgroundColor: selected ? C.accent + '15' : 'transparent',
        borderTopWidth: first ? 0 : 1,
        borderTopColor: C.divider,
      }}
    >
      <Text style={{ fontSize: 18 }}>{emoji}</Text>
      <View style={{ flex: 1 }}>
        <Text
          style={[
            T.bodyMd,
            { color: accent ? C.accent : C.text, fontWeight: '700' },
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
        {sub && (
          <Text style={[T.caption, { color: C.text3 }]} numberOfLines={1}>
            {sub}
          </Text>
        )}
      </View>
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
        {selected && <Icon.ok size={14} color="#fff" strokeWidth={2.8} />}
      </View>
    </PressableScale>
  );
}
