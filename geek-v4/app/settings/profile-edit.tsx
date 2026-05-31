import { View, Text, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, TextInput, Image } from 'react-native';
import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Avatar } from '../../components/ui/Avatar';
import { PressableScale } from '../../components/ui/PressableScale';
import { useAuthStore } from '../../stores/authStore';
import { useToastStore } from '../../stores/toastStore';
import { supabase } from '../../lib/supabase';
import { prepareImageUpload } from '../../lib/image';
import { openCropper } from '../../lib/imageCropper';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { Icon } from '../../constants/icons';

const AVATAR_EMOJIS = [
  '😀', '😎', '🥰', '🤩', '🥳', '😇', '🤓', '🥸',
  '😈', '👽', '🤖', '👻', '🎃', '💀', '🦄', '🐱',
  '🐶', '🐻', '🦊', '🐼', '🐯', '🦁', '🐸', '🦉',
  '🌸', '🌟', '⚡', '🔥', '💎', '🎨', '🎮', '🎵',
];

const BIO_MAX = 200;

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
  // アバター / カバーで個別に upload 状態を持ち、片方の upload 中にもう片方の
  // ボタンが固まらないようにする。save は両方の uploading を見て disable する。
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
    if (!user) return;
    if (uploadingAvatar) return;
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
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, prepared.blob, {
        contentType: prepared.mime,
        upsert: true,
      });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
      setAvatarUrl(pub.publicUrl);
      setEmoji(null);
      show('アイコンをアップロードしました', 'success');
    } catch (e) {
      console.warn('avatar upload error:', e);
      const detail = e instanceof Error ? e.message : (e !== null && typeof e === 'object' && 'message' in e) ? String((e as {message: unknown}).message) : '';
      show(detail.includes('大きすぎ') ? detail : 'アップロードに失敗しました', 'error');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const removeAvatar = () => {
    setAvatarUrl(null);
  };

  // ===== カバー (横長・circular cropper は使わない) =====
  // native は OS の crop UI を 16:9 で出す。Web は prepareImageUpload で
  // 1600x900 に内側 fit で resize して保存 (cover 表示時に中央寄せ)。
  // 既存 `avatars` bucket を path で分離して流用 (cover_<ts>.<ext>)。
  const pickCover = async () => {
    if (!user) return;
    if (uploadingCover) return;
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
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, prepared.blob, {
        contentType: prepared.mime,
        upsert: true,
      });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
      setCoverUrl(pub.publicUrl);
      show('カバー画像をアップロードしました', 'success');
    } catch (e) {
      console.warn('cover upload error:', e);
      const detail = e instanceof Error ? e.message : (e !== null && typeof e === 'object' && 'message' in e) ? String((e as {message: unknown}).message) : '';
      show(detail.includes('大きすぎ') ? detail : 'アップロードに失敗しました', 'error');
    } finally {
      setUploadingCover(false);
    }
  };

  const removeCover = () => {
    setCoverUrl(null);
  };

  const save = async () => {
    if (!user) return;
    if (loading || uploading) return;
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

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: C.bg }}
    >
      <TopBar title="プロフィール編集" left={<BackButton />} />
      <ScrollView
        contentContainerStyle={{
          padding: SP['4'],
          paddingBottom: insets.bottom + SP['10'],
          gap: SP['5'],
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* ===== カバー画像 ===== */}
        <View style={{ gap: SP['2'] }}>
          <Text style={[T.smallM, { color: C.text2 }]}>カバー画像</Text>
          <View
            style={{
              height: 140,
              borderRadius: R.lg,
              backgroundColor: C.bg2,
              borderWidth: 1,
              borderColor: C.border,
              overflow: 'hidden',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {coverUrl ? (
              <Image source={{ uri: coverUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
            ) : (
              <View style={{ alignItems: 'center', gap: 6 }}>
                <Icon.image size={28} color={C.text3} strokeWidth={1.8} />
                <Text style={[T.caption, { color: C.text3 }]}>未設定 (16:9 推奨)</Text>
              </View>
            )}
          </View>
          <View style={{ flexDirection: 'row', gap: SP['2'] }}>
            <PressableScale
              onPress={pickCover}
              haptic="tap"
              disabled={uploadingCover}
              accessibilityState={{ busy: uploadingCover, disabled: uploadingCover }}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: SP['1'],
                paddingHorizontal: SP['3'], paddingVertical: SP['2'],
                backgroundColor: C.accent, borderRadius: R.full,
                opacity: uploadingCover ? 0.6 : 1,
              }}
            >
              {uploadingCover ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Icon.camera size={16} color="#fff" strokeWidth={2.2} />
              )}
              <Text style={[T.smallM, { color: '#fff' }]}>
                {uploadingCover ? 'アップロード中…' : coverUrl ? 'カバーを変更' : 'カバーを選ぶ'}
              </Text>
            </PressableScale>
            {coverUrl && (
              <PressableScale
                onPress={removeCover}
                haptic="warn"
                style={{
                  paddingHorizontal: SP['3'], paddingVertical: SP['2'],
                  backgroundColor: C.bg3, borderRadius: R.full,
                  borderWidth: 1, borderColor: C.border,
                }}
              >
                <Text style={[T.smallM, { color: C.text2 }]}>外す</Text>
              </PressableScale>
            )}
          </View>
        </View>

        {/* ===== アバター ===== */}
        <View style={{ alignItems: 'center', gap: SP['3'] }}>
          <Avatar size={120} name={nickname} emoji={emoji ?? undefined} uri={avatarUrl ?? undefined} />
          <View style={{ flexDirection: 'row', gap: SP['2'] }}>
            <PressableScale
              onPress={pickAvatar}
              haptic="tap"
              disabled={uploadingAvatar}
              accessibilityState={{ busy: uploadingAvatar, disabled: uploadingAvatar }}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: SP['1'],
                paddingHorizontal: SP['3'], paddingVertical: SP['2'],
                backgroundColor: C.accent, borderRadius: R.full,
                opacity: uploadingAvatar ? 0.6 : 1,
              }}
            >
              {uploadingAvatar ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Icon.camera size={16} color="#fff" strokeWidth={2.2} />
              )}
              <Text style={[T.smallM, { color: '#fff' }]}>
                {uploadingAvatar ? 'アップロード中…' : 'アイコンを選ぶ'}
              </Text>
            </PressableScale>
            {avatarUrl && (
              <PressableScale
                onPress={removeAvatar}
                haptic="warn"
                style={{
                  paddingHorizontal: SP['3'], paddingVertical: SP['2'],
                  backgroundColor: C.bg3, borderRadius: R.full,
                  borderWidth: 1, borderColor: C.border,
                }}
              >
                <Text style={[T.smallM, { color: C.text2 }]}>外す</Text>
              </PressableScale>
            )}
          </View>
          <Text style={[T.caption, { color: C.text3, textAlign: 'center' }]}>
            🔒 このアイコンとニックネームは自分にだけ見えます{'\n'}
            他のユーザーから見たあなたは常に「匿」マークの匿名表示です
          </Text>
        </View>

        {/* ===== ニックネーム ===== */}
        <View style={{ gap: SP['1'] }}>
          <Input
            label="ニックネーム（自分用）"
            icon={Icon.mypage}
            value={nickname}
            onChangeText={setNickname}
            placeholder="例: ぽけオタク"
            maxLength={20}
            returnKeyType="done"
          />
          <Text style={[T.caption, {
            color: Array.from(nickname.trim()).length > 20 ? C.amber : C.text3,
            textAlign: 'right',
            paddingRight: SP['1'],
            fontVariant: ['tabular-nums'],
          }]}>
            {Array.from(nickname.trim()).length}/20
          </Text>
        </View>

        {/* ===== 自己紹介 (bio) ===== */}
        <View style={{ gap: SP['1'] }}>
          <Text style={[T.smallM, { color: C.text2 }]}>自己紹介（任意）</Text>
          <View
            style={{
              backgroundColor: C.bg2,
              borderWidth: 1,
              borderColor: C.border,
              borderRadius: R.md,
              paddingHorizontal: SP['3'],
              paddingVertical: 10,
            }}
          >
            <TextInput
              value={bio}
              onChangeText={(t) => setBio(t.slice(0, BIO_MAX))}
              placeholder="あなたについて (200文字まで)"
              placeholderTextColor={C.text3}
              selectionColor={C.accent}
              cursorColor={C.accent}
              multiline
              maxLength={BIO_MAX}
              underlineColorAndroid="transparent"
              style={[T.body, { color: C.text, minHeight: 96, textAlignVertical: 'top' }]}
            />
          </View>
          <Text style={[T.caption, {
            color: bio.length > BIO_MAX * 0.9 ? C.amber : C.text3,
            textAlign: 'right',
            paddingRight: SP['1'],
            fontVariant: ['tabular-nums'],
          }]}>
            {bio.length}/{BIO_MAX}
          </Text>
        </View>

        {/* ===== 絵文字アイコン選択 ===== */}
        <View style={{ gap: SP['2'] }}>
          <Text style={[T.smallM, { color: C.text2 }]}>
            または絵文字から選ぶ
          </Text>
          <View style={{
            flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'],
            padding: SP['3'],
            backgroundColor: C.bg2,
            borderRadius: R.lg,
            borderWidth: 1,
            borderColor: C.border,
          }}>
            {AVATAR_EMOJIS.map((e) => (
              <PressableScale
                key={e}
                onPress={() => { setEmoji(e); setAvatarUrl(null); }}
                haptic="select"
                style={{
                  width: 48, height: 48, borderRadius: 24,
                  backgroundColor: emoji === e ? C.accentBg : C.bg3,
                  alignItems: 'center', justifyContent: 'center',
                  borderWidth: emoji === e ? 2 : 1,
                  borderColor: emoji === e ? C.accent : C.border,
                }}
              >
                <Text style={{ fontSize: 24 }}>{e}</Text>
              </PressableScale>
            ))}
          </View>
        </View>

        <Button label="保存" onPress={save} loading={loading} disabled={uploading} />
        {uploading && (
          <Text style={[T.caption, { color: C.text3, textAlign: 'center', marginTop: -SP['2'] }]}>
            画像アップロード中は保存できません
          </Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
