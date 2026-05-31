// =============================================================================
// app/settings/profile-edit.tsx — プロフィール編集 (EDITORIAL「特集」言語)
// -----------------------------------------------------------------------------
// マイページの鉛筆バッジから飛ぶ画面。アイコン (写真 / 絵文字)・カバー画像・
// ニックネーム・自己紹介 (bio) を 1 画面で編集する。
//
// デザイン言語: 検索 / コミュ作成と同じ「特集」(EDITORIAL):
//   - 黒地 C.bg + 1px hairlines + 大型 Apple SF 系見出し
//   - 紫 accent を一点集中、塗りカードは subtle のみ
//   - セクション = 大文字小型ラベル (LOGO_FONT) + コンテンツ
//   - 入力欄 = EditorialField (下線一本 / 文字数カウンタは部品自体が持つので
//     重複表示しない)
//   - 保存 = EditorialSubmitBar
// =============================================================================

import { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Lock, Camera, Image as ImageIcon } from 'lucide-react-native';

import { useAuthStore } from '../../stores/authStore';
import { useToastStore } from '../../stores/toastStore';
import { supabase } from '../../lib/supabase';
import { prepareImageUpload } from '../../lib/image';
import { openCropper } from '../../lib/imageCropper';
import { PressableScale } from '../../components/ui/PressableScale';
import { HeroAvatar } from '../../components/mypage/HeroAvatar';
import { EditorialFormHeader } from '../../components/community/EditorialFormHeader';
import { EditorialField } from '../../components/community/EditorialField';
import { EditorialSubmitBar } from '../../components/community/EditorialSubmitBar';
import { C, R, SP } from '../../design/tokens';
import { T, LOGO_FONT, LOGO_FONT_WEIGHT } from '../../design/typography';

const BIO_MAX = 200;
// 絵文字アイコン選択は UI を撤去 (2026-05-31)。emoji フィールド自体は既存ユーザの
// 値を保持するため state / fetch / update には残す。新規選択は写真のみ。

export default function ProfileEditScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const refreshProfile = useAuthStore((s) => s.refreshProfile);
  const show = useToastStore((s) => s.show);

  const [nickname, setNickname] = useState(user?.nickname ?? '');
  const [bio, setBio] = useState('');
  const [emoji, setEmoji] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const uploading = uploadingAvatar || uploadingCover;

  useEffect(() => {
    (async () => {
      if (!user) return;
      const { data } = await supabase
        .from('profiles')
        .select('nickname, bio, avatar_emoji, avatar_url, cover_url')
        .eq('id', user.id)
        .single();
      if (data) {
        const row = data as {
          nickname: string | null;
          bio: string | null;
          avatar_emoji: string | null;
          avatar_url: string | null;
          cover_url: string | null;
        };
        setNickname(row.nickname ?? '');
        setBio(row.bio ?? '');
        setEmoji(row.avatar_emoji ?? null);
        setAvatarUrl(row.avatar_url ?? null);
        setCoverUrl(row.cover_url ?? null);
      }
    })();
  }, [user]);

  // ===== アバター (正方形・circular cropper) =====
  const pickAvatar = async () => {
    if (!user || uploadingAvatar) return;
    if (Platform.OS !== 'web') {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        show('写真へのアクセス権限が必要です', 'warn');
        return;
      }
    }
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsEditing: Platform.OS !== 'web',
      aspect: Platform.OS !== 'web' ? [1, 1] : undefined,
      quality: 0.8,
    });
    if (r.canceled || !r.assets[0]) return;
    const asset = r.assets[0];
    let croppedUri: string = asset.uri;
    if (Platform.OS === 'web') {
      const cropped = await openCropper(asset.uri);
      if (!cropped) return;
      croppedUri = cropped;
    }
    setUploadingAvatar(true);
    try {
      const prepared = await prepareImageUpload(croppedUri, { maxSizeBytes: 5 * 1024 * 1024 });
      const path = `${user.id}/${Date.now()}.${prepared.ext}`;
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, prepared.blob, { contentType: prepared.mime, upsert: true });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
      setAvatarUrl(pub.publicUrl);
      setEmoji(null);
      show('アイコンをアップロードしました', 'success');
    } catch (e) {
      console.warn('avatar upload error:', e);
      const detail = e instanceof Error
        ? e.message
        : (e !== null && typeof e === 'object' && 'message' in e)
          ? String((e as { message: unknown }).message)
          : '';
      show(detail.includes('大きすぎ') ? detail : 'アップロードに失敗しました', 'error');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const removeAvatar = () => setAvatarUrl(null);

  // ===== カバー (横長・OS の crop UI を 16:9 で / Web は cropper なし resize) =====
  const pickCover = async () => {
    if (!user || uploadingCover) return;
    if (Platform.OS !== 'web') {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        show('写真へのアクセス権限が必要です', 'warn');
        return;
      }
    }
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsEditing: Platform.OS !== 'web',
      aspect: Platform.OS !== 'web' ? [16, 9] : undefined,
      quality: 0.85,
    });
    if (r.canceled || !r.assets[0]) return;
    const asset = r.assets[0];
    setUploadingCover(true);
    try {
      const prepared = await prepareImageUpload(asset.uri, {
        maxSizeBytes: 5 * 1024 * 1024,
        maxWidth: 1600,
        maxHeight: 900,
        quality: 0.85,
      });
      const path = `${user.id}/cover_${Date.now()}.${prepared.ext}`;
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, prepared.blob, { contentType: prepared.mime, upsert: true });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
      setCoverUrl(pub.publicUrl);
      show('カバー画像をアップロードしました', 'success');
    } catch (e) {
      console.warn('cover upload error:', e);
      const detail = e instanceof Error
        ? e.message
        : (e !== null && typeof e === 'object' && 'message' in e)
          ? String((e as { message: unknown }).message)
          : '';
      show(detail.includes('大きすぎ') ? detail : 'アップロードに失敗しました', 'error');
    } finally {
      setUploadingCover(false);
    }
  };

  const removeCover = () => setCoverUrl(null);

  const save = async () => {
    if (!user || loading || uploading) return;
    const trimmedNickname = nickname.trim();
    if (trimmedNickname.length < 2) {
      show('ニックネームは2文字以上で入力してください', 'warn');
      return;
    }
    if (Array.from(trimmedNickname).length > 20) {
      show('ニックネームは20文字以内にしてください', 'warn');
      return;
    }
    if (bio.length > BIO_MAX) {
      show(`自己紹介は${BIO_MAX}文字以内にしてください`, 'warn');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          nickname: trimmedNickname,
          bio: bio.trim() || null,
          avatar_emoji: emoji,
          avatar_url: avatarUrl,
          cover_url: coverUrl,
        })
        .eq('id', user.id);
      if (error) {
        const msg = error.message.toLowerCase();
        if (msg.includes('duplicate') || msg.includes('unique')) {
          show('このニックネームは既に使われています', 'error');
        } else {
          show('保存に失敗しました', 'error');
        }
        return;
      }
      show('保存しました', 'success');
      await refreshProfile();
      router.back();
    } catch {
      show('ネットワークエラー。接続を確認してください。', 'error');
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = !uploading && nickname.trim().length >= 2 && bio.length <= BIO_MAX;
  const disabledReason =
    nickname.trim().length < 2
      ? 'ニックネームを 2 文字以上で入力してください'
      : bio.length > BIO_MAX
        ? `自己紹介は ${BIO_MAX} 文字以内にしてください`
        : uploading
          ? '画像アップロード中は保存できません'
          : null;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: C.bg }}
    >
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + SP['2'],
          paddingBottom: insets.bottom + SP['12'],
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ===== マストヘッド ===== */}
        <EditorialFormHeader
          titleEn="EDIT PROFILE"
          titleJa="プロフィール"
          onBack={() => router.back()}
        />

        {/* ===== COVER ===== */}
        <Section label="COVER" topGap>
          <View
            style={{
              height: 160,
              borderRadius: R.lg,
              backgroundColor: C.bg2,
              borderWidth: 1,
              borderColor: C.divider,
              overflow: 'hidden',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {coverUrl ? (
              <Image source={{ uri: coverUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
            ) : (
              <View style={{ alignItems: 'center', gap: 6 }}>
                <ImageIcon size={26} color={C.text3} strokeWidth={1.6} />
                <Text style={[T.caption, { color: C.text3 }]}>未設定 (16:9 推奨)</Text>
              </View>
            )}
            {uploadingCover ? (
              <View
                style={{
                  ...StyleSheetAbsoluteFill,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'rgba(0,0,0,0.5)',
                }}
              >
                <ActivityIndicator color={C.accent} />
              </View>
            ) : null}
          </View>
          <LinkRow>
            <ActionLink
              onPress={pickCover}
              disabled={uploadingCover}
              accessibilityLabel="カバーを変更"
              icon={<Camera size={13} color={C.accent} strokeWidth={2.2} />}
              label={coverUrl ? 'カバーを変更' : 'カバーを選ぶ'}
            />
            {coverUrl ? (
              <ActionLink
                onPress={removeCover}
                disabled={uploadingCover}
                variant="muted"
                accessibilityLabel="カバーを外す"
                label="外す"
              />
            ) : null}
          </LinkRow>
        </Section>

        {/* ===== AVATAR ===== */}
        <Section label="AVATAR" topGap>
          <View style={{ alignItems: 'center', gap: SP['3'] }}>
            <View
              style={{
                borderRadius: 70,
                backgroundColor: C.bg,
                padding: 4,
                position: 'relative',
              }}
            >
              <HeroAvatar
                size={128}
                nickname={nickname}
                avatarEmoji={emoji}
                avatarUrl={avatarUrl}
              />
              {uploadingAvatar ? (
                <View
                  style={{
                    ...StyleSheetAbsoluteFill,
                    borderRadius: 70,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'rgba(0,0,0,0.45)',
                  }}
                >
                  <ActivityIndicator color={C.accent} />
                </View>
              ) : null}
            </View>

          </View>

          <LinkRow center>
            <ActionLink
              onPress={pickAvatar}
              disabled={uploadingAvatar}
              accessibilityLabel="写真を選ぶ"
              icon={<Camera size={13} color={C.accent} strokeWidth={2.2} />}
              label={avatarUrl ? 'アイコン画像を変更' : 'アイコン画像を選ぶ'}
            />
            {avatarUrl ? (
              <ActionLink
                onPress={removeAvatar}
                disabled={uploadingAvatar}
                variant="muted"
                accessibilityLabel="写真を外す"
                label="外す"
              />
            ) : null}
          </LinkRow>

          {/* プライバシー注記 */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: SP['2'],
              marginTop: SP['3'],
              paddingHorizontal: SP['3'],
              paddingVertical: SP['3'],
              backgroundColor: C.bg2,
              borderRadius: R.md,
              borderWidth: 1,
              borderColor: C.divider,
            }}
          >
            <Lock size={14} color={C.text3} strokeWidth={2.2} style={{ marginTop: 2 }} />
            <Text style={[T.caption, { color: C.text3, flex: 1, lineHeight: 18 }]}>
              アイコンとニックネームは自分にだけ見えます。他のユーザーから見たあなたは常に「匿」マークの匿名表示です。
            </Text>
          </View>
        </Section>

        {/* ===== NAME ===== */}
        <Section label="NAME" topGap>
          <EditorialField
            label="ニックネーム"
            required
            hint="自分が見る名前 (2〜20 文字)"
            value={nickname}
            onChangeText={setNickname}
            placeholder="例: ぽけオタク"
            maxLength={20}
            showCount
            returnKeyType="done"
          />
        </Section>

        {/* ===== BIO ===== */}
        <Section label="ABOUT" topGap>
          <EditorialField
            label="自己紹介"
            hint="あなたについて、好きなもの、最近ハマっているもの"
            value={bio}
            onChangeText={(t) => setBio(t.slice(0, BIO_MAX))}
            placeholder="例: アニメと音楽が好き。最近は◯◯にハマっています。"
            maxLength={BIO_MAX}
            multiline
            showCount
          />
        </Section>

        {/* ===== SAVE ===== */}
        <View style={{ marginTop: SP['8'] }}>
          <EditorialSubmitBar
            label="変更を保存"
            onPress={save}
            loading={loading}
            disabled={!canSubmit}
            disabledReason={disabledReason}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// =============================================================================
// 内部の小部品
// =============================================================================

const StyleSheetAbsoluteFill = {
  position: 'absolute' as const,
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
};

function Section({
  label,
  topGap,
  children,
}: {
  label: string;
  topGap?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View
      style={{
        paddingHorizontal: SP['5'],
        marginTop: topGap ? SP['6'] : 0,
        gap: SP['3'],
      }}
    >
      <Text
        style={{
          fontFamily: LOGO_FONT,
          fontWeight: LOGO_FONT_WEIGHT,
          fontSize: 11,
          lineHeight: 14,
          letterSpacing: 1.8,
          color: C.text3,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </Text>
      {children}
    </View>
  );
}

function LinkRow({ children, center }: { children: React.ReactNode; center?: boolean }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['4'],
        justifyContent: center ? 'center' : 'flex-start',
        marginTop: SP['1'],
      }}
    >
      {children}
    </View>
  );
}

function ActionLink({
  onPress,
  label,
  icon,
  disabled,
  variant = 'accent',
  accessibilityLabel,
}: {
  onPress: () => void;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  variant?: 'accent' | 'muted';
  accessibilityLabel: string;
}) {
  const color = variant === 'accent' ? C.accent : C.text3;
  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={{ alignItems: 'center', opacity: disabled ? 0.5 : 1 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        {icon}
        <Text style={[T.smallB, { color, fontSize: 13 }]}>{label}</Text>
      </View>
      {/* accent variant のみ下線 (EDITORIAL の所作) */}
      {variant === 'accent' ? (
        <View
          style={{
            alignSelf: 'stretch',
            height: 1,
            backgroundColor: color,
            marginTop: 3,
          }}
        />
      ) : null}
    </PressableScale>
  );
}

