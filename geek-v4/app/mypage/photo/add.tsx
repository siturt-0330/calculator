// ============================================================
// app/mypage/photo/add.tsx — 写真追加 flow
// ============================================================
// spec: docs/MYPAGE_ALBUMS_SPEC.md § 6  + UI Polish (Phase 2 / U5) docs/UI_POLISH_SPEC.md § 6
// - searchParam で albumId (任意) を受け取る. 無ければ単独写真.
// - 画面 mount で picker は起動しない (旧仕様の「即起動 → 即 form」のカクついた切替を
//   廃止). 代わりに中央に大きい「+ 写真を選ぶ」 CTA (GlassCard 風 / dashed border) を
//   表示し、タップで ImagePicker.launchImageLibraryAsync を呼ぶ。
// - 写真選択後: 中央上部に大きい thumbnail preview (rounded, SHADOW.md) を表示し、
//   下に form (caption / album / visibility / 共有相手) を GlassCard でラップ。
// - 写真は正方形 crop しない (思い出写真は縦長/横長が多い) — openCropper を skip.
// - 「アップロード」 → PolishedButton variant='gradient' gradient='warm' (action 感) で
//   useUploadPhoto → success toast → router.back()
// - upload 中: 全画面 overlay + GradientCard で「アップロード中…」 spinner を出す。
// - cancel → router.back()
//
// 画像 upload は必ず prepareImageUpload 経由 (CLAUDE.md § 5.9 / spec § 4)。
// useUploadPhoto の mutationFn 内で prepareImageUpload を call しているので、
// 画面側は asset.uri を直接渡す。
// ============================================================

import { useState } from 'react';
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
import { PolishedButton } from '../../../components/ui/PolishedButton';
import { GlassCard } from '../../../components/ui/GlassCard';
import { GradientCard } from '../../../components/ui/GradientCard';
import { PressableScale } from '../../../components/ui/PressableScale';
import { SegmentedControl } from '../../../components/ui/SegmentedControl';
import { Avatar } from '../../../components/ui/Avatar';
import { useMyAlbums, useUploadPhoto } from '../../../hooks/useAlbums';
import { useMyFriends } from '../../../hooks/useFriends';
import { useToastStore } from '../../../stores/toastStore';
import { Icon } from '../../../constants/icons';
import { C, R, SP, SHADOW } from '../../../design/tokens';
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
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const show = useToastStore((s) => s.show);

  const { albums } = useMyAlbums();
  const { friends } = useMyFriends();
  const uploadPhoto = useUploadPhoto();

  // 選択した画像 (null = まだ未選択 — picker CTA を出す)
  const [pickedUri, setPickedUri] = useState<string | null>(null);
  // picker 呼び出し中フラグ — タップ連打防止 + UI で disabled 化
  const [picking, setPicking] = useState(false);

  // フォーム
  const [caption, setCaption] = useState('');
  // albumId 未指定なら「どこに入れるか」 selector を出す。
  //   - NEW_ALBUM_SENTINEL: 新規アルバムを作る (Phase 1 では一旦 toast で誘導)
  //   - 空文字 or null: 単独写真 (album_id=null)
  //   - uuid: 既存 album
  const [selectedAlbumId, setSelectedAlbumId] = useState<string>('');
  const [visibility, setVisibility] = useState<PhotoVisibility>('private');
  const [sharedWith, setSharedWith] = useState<string[]>([]);

  // ============================================================
  // ImagePicker 起動 — 初回 CTA と「別の写真を選ぶ」両方から呼ぶ
  // ============================================================
  const launchPicker = async () => {
    if (picking || uploadPhoto.isPending) return;
    setPicking(true);
    try {
      if (Platform.OS !== 'web') {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          show('写真へのアクセス権限が必要です', 'warn');
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
        // キャンセルは画面に留まる (旧仕様は router.back() だったが、再選択チャンスを与える)。
        return;
      }
      setPickedUri(r.assets[0].uri);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '画像の取得に失敗しました';
      show(msg, 'error');
    } finally {
      setPicking(false);
    }
  };

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
  // 写真未選択 → 中央に大きい「+ 写真を選ぶ」 CTA を表示
  // ============================================================
  if (!pickedUri) {
    // 画面の 50% 程度を占める CTA カードを center 配置。
    const ctaSize = Math.min(screenWidth - SP['4'] * 2, screenHeight * 0.5);
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <TopBar title="写真を追加" left={<BackButton />} />
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            padding: SP['4'],
          }}
        >
          <PressableScale
            onPress={launchPicker}
            haptic="confirm"
            disabled={picking}
            accessibilityLabel="写真を選ぶ"
            scaleValue={0.98}
            style={{
              width: ctaSize,
              height: ctaSize,
              borderRadius: R.xl,
              borderWidth: 2,
              borderColor: C.border2,
              borderStyle: 'dashed',
              backgroundColor: C.glass,
              alignItems: 'center',
              justifyContent: 'center',
              gap: SP['3'],
              opacity: picking ? 0.6 : 1,
              ...SHADOW.sm,
            }}
          >
            {picking ? (
              <ActivityIndicator color={C.accent} size="large" />
            ) : (
              <>
                <Text style={{ fontSize: 64, lineHeight: 72 }}>📷</Text>
                <Text
                  style={[
                    T.h3,
                    { color: C.text, textAlign: 'center', letterSpacing: -0.3 },
                  ]}
                >
                  + 写真を選ぶ
                </Text>
                <Text
                  style={[
                    T.small,
                    { color: C.text3, textAlign: 'center', maxWidth: 240 },
                  ]}
                >
                  ライブラリから 1 枚選んでください
                </Text>
              </>
            )}
          </PressableScale>
        </View>
      </View>
    );
  }

  // ============================================================
  // 写真選択済み → preview + form
  // ============================================================
  // image preview の縦横比を計算 — spec § 6: max width 240, aspectRatio 維持
  const previewMaxW = Math.min(240, Math.round(screenWidth * 0.6));

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
          gap: SP['4'],
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* ───── プレビュー (中央上部, rounded 16, SHADOW.md) ───── */}
        <View style={{ alignItems: 'center', gap: SP['3'] }}>
          <View
            style={{
              width: previewMaxW,
              aspectRatio: 1,
              backgroundColor: '#000',
              borderRadius: R.xl,
              overflow: 'hidden',
              borderWidth: 1,
              borderColor: C.border,
              ...SHADOW.md,
            }}
          >
            <Image
              source={{ uri: pickedUri }}
              style={{ width: '100%', height: '100%' }}
              contentFit="cover"
              cachePolicy="memory"
              transition={120}
            />
          </View>
          {/* 別の写真を選ぶ */}
          <PolishedButton
            variant="outline"
            label="別の写真を選ぶ"
            onPress={launchPicker}
            haptic="tap"
            disabled={uploadPhoto.isPending || picking}
            loading={picking}
            size="sm"
          />
        </View>

        {/* ───── form (GlassCard でラップ) ───── */}
        <GlassCard style={{ gap: SP['4'] }}>
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
        </GlassCard>

        {/* ───── CTA ───── */}
        <View style={{ gap: SP['2'], marginTop: SP['2'] }}>
          <PolishedButton
            variant="gradient"
            gradient="warm"
            label={uploadPhoto.isPending ? 'アップロード中…' : 'アップロード'}
            onPress={handleUpload}
            haptic="confirm"
            disabled={uploadPhoto.isPending || !pickedUri}
            loading={uploadPhoto.isPending}
            size="lg"
            fullWidth
          />
          <PolishedButton
            variant="outline"
            label="キャンセル"
            onPress={handleCancel}
            haptic="tap"
            disabled={uploadPhoto.isPending}
            size="md"
            fullWidth
          />
        </View>
      </ScrollView>

      {/* ───── upload 中 overlay ─────
          Modal を使うと web/native で挙動差が出るので absoluteFill View で代替。
          pointerEvents は親 KeyboardAvoidingView 配下に挿入時に Web 側で意図しない
          フォーカス漏れがあるので、明示的に 'auto' を残す。 */}
      {uploadPhoto.isPending && (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            alignItems: 'center',
            justifyContent: 'center',
            padding: SP['6'],
          }}
        >
          <GradientCard gradient="primary" glow style={{ minWidth: 220 }}>
            <View style={{ alignItems: 'center', gap: SP['3'], padding: SP['2'] }}>
              <ActivityIndicator size="large" color="#fff" />
              <Text
                style={[
                  T.h4,
                  { color: '#fff', textAlign: 'center', letterSpacing: 0.3 },
                ]}
              >
                アップロード中…
              </Text>
              <Text
                style={[
                  T.small,
                  { color: 'rgba(255,255,255,0.85)', textAlign: 'center' },
                ]}
              >
                少々お待ちください
              </Text>
            </View>
          </GradientCard>
        </View>
      )}
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
