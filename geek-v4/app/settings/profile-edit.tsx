import { View, Text, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
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
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { Icon } from '../../constants/icons';

const AVATAR_EMOJIS = [
  '😀', '😎', '🥰', '🤩', '🥳', '😇', '🤓', '🥸',
  '😈', '👽', '🤖', '👻', '🎃', '💀', '🦄', '🐱',
  '🐶', '🐻', '🦊', '🐼', '🐯', '🦁', '🐸', '🦉',
  '🌸', '🌟', '⚡', '🔥', '💎', '🎨', '🎮', '🎵',
];

async function uriToBlob(uri: string): Promise<Blob> {
  const res = await fetch(uri);
  return res.blob();
}

export default function ProfileEditScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, refreshProfile } = useAuthStore();
  const { show } = useToastStore();
  const [nickname, setNickname] = useState(user?.nickname ?? '');
  const [emoji, setEmoji] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    (async () => {
      if (!user) return;
      const { data } = await supabase
        .from('profiles')
        .select('nickname, avatar_emoji, avatar_url')
        .eq('id', user.id)
        .single();
      if (data) {
        setNickname(data.nickname ?? '');
        setEmoji(data.avatar_emoji ?? null);
        setAvatarUrl(data.avatar_url ?? null);
      }
    })();
  }, [user]);

  const pickPhoto = async () => {
    if (!user) return;
    if (Platform.OS !== 'web') {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        show('写真へのアクセス権限が必要です', 'warn');
        return;
      }
    }
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (r.canceled || !r.assets[0]) return;
    const asset = r.assets[0];
    setUploading(true);
    try {
      const blob = await uriToBlob(asset.uri);
      const ext = asset.mimeType?.split('/')[1] ?? 'jpg';
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, blob, {
        contentType: asset.mimeType ?? 'image/jpeg',
        upsert: true,
      });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
      setAvatarUrl(pub.publicUrl);
      setEmoji(null);
      show('画像をアップロードしました', 'success');
    } catch (e) {
      console.warn('upload error:', e);
      show('アップロードに失敗しました', 'error');
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = () => {
    setAvatarUrl(null);
  };

  const save = async () => {
    if (!user) return;
    // 二重 submit 防止 — ボタン連打で重複 update を防ぐ
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
    setLoading(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ nickname: trimmedNickname, avatar_emoji: emoji, avatar_url: avatarUrl })
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
      // ネットワーク例外でも loading を確実に解除する
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
        {/* 現在のアバター */}
        <View style={{ alignItems: 'center', gap: SP['3'] }}>
          <Avatar size={120} name={nickname} emoji={emoji ?? undefined} uri={avatarUrl ?? undefined} />
          <View style={{ flexDirection: 'row', gap: SP['2'] }}>
            <PressableScale
              onPress={pickPhoto}
              haptic="tap"
              disabled={uploading}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: SP['1'],
                paddingHorizontal: SP['3'], paddingVertical: SP['2'],
                backgroundColor: C.accent, borderRadius: R.full,
              }}
            >
              <Icon.camera size={16} color="#fff" strokeWidth={2.2} />
              <Text style={[T.smallM, { color: '#fff' }]}>
                {uploading ? 'アップロード中…' : '写真を選ぶ'}
              </Text>
            </PressableScale>
            {avatarUrl && (
              <PressableScale
                onPress={removePhoto}
                haptic="warn"
                style={{
                  paddingHorizontal: SP['3'], paddingVertical: SP['2'],
                  backgroundColor: C.bg3, borderRadius: R.full,
                  borderWidth: 1, borderColor: C.border,
                }}
              >
                <Text style={[T.smallM, { color: C.text2 }]}>写真を外す</Text>
              </PressableScale>
            )}
          </View>
          <Text style={[T.caption, { color: C.text3, textAlign: 'center' }]}>
            🔒 このアイコンとニックネームは自分にだけ見えます{'\n'}
            他のユーザーから見たあなたは常に「匿」マークの匿名表示です
          </Text>
        </View>

        <Input
          label="ニックネーム（自分用）"
          icon={Icon.mypage}
          value={nickname}
          onChangeText={setNickname}
          placeholder="例: ぽけオタク"
          maxLength={20}
          // 改行キーで直接保存 — フォームを下までスクロールせず済む
          returnKeyType="done"
          onSubmitEditing={() => { void save(); }}
        />

        {/* 絵文字アイコン選択 */}
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
