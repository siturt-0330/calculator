import { View, Text, KeyboardAvoidingView, Platform } from 'react-native';
import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Icon } from '@/constants/icons';
import { useAuthStore } from '@/stores/authStore';
import { useToastStore } from '@/stores/toastStore';
import { supabase } from '@/lib/supabase';

export default function NicknameScreen() {
  const [nickname, setNickname] = useState('');
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const UserIcon = Icon.mypage;
  const { user, setUser } = useAuthStore();
  const { show } = useToastStore();

  useEffect(() => {
    if (user?.nickname) setNickname(user.nickname);
  }, [user?.nickname]);

  // 2 - 20 文字以外なら error message を出す (空のまま放置されているときは出さない)
  const trimmed = nickname.trim();
  const tooShort = touched && trimmed.length > 0 && trimmed.length < 2;
  const tooLong = trimmed.length > 20;
  const canSubmit = trimmed.length >= 2 && trimmed.length <= 20 && !saving;

  const next = async () => {
    if (!canSubmit) {
      setTouched(true);
      if (trimmed.length < 2) {
        show('ニックネームは 2 文字以上にしてください。', 'warn');
      }
      return;
    }
    if (user) {
      setSaving(true);
      try {
        // upsert 結果を確認 — RLS / trigger / 接続エラー全てに対応
        const { error } = await supabase
          .from('profiles')
          .upsert({ id: user.id, nickname: trimmed })
          .select();
        if (error) {
          console.warn('[nickname] profile upsert failed:', error.message);
          // ニックネームは onboarding 完了時に notifications.tsx 側で fallback 挿入されるので
          // ここでは「進めるけど警告は出す」方針 — ブロックすると初回ユーザーが詰む
          show('ニックネームの保存に失敗しましたが、続行します。', 'warn');
        } else {
          // ローカルストアも即時更新 — マイページ等で古いニックネームが見えるのを防ぐ
          setUser({ ...user, nickname: trimmed });
        }
      } catch (e) {
        console.warn('[nickname] upsert exception:', e);
        show('ネットワークエラー。続行します。', 'warn');
      } finally {
        setSaving(false);
      }
    }
    router.push('/onboarding/liked-tags');
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: C.bg }}
    >
      <View
        style={{
          flex: 1,
          paddingTop: insets.top + SP['8'],
          paddingHorizontal: SP['6'],
          paddingBottom: insets.bottom + SP['6'],
          gap: SP['6'],
        }}
      >
        <View style={{ gap: SP['2'] }}>
          <Text style={[T.h1, { color: C.text }]}>ニックネームを決めよう</Text>
          <Text style={[T.body, { color: C.text2 }]}>
            匿名投稿時は表示されません。自分だけに見えます。
          </Text>
        </View>
        <View style={{ gap: SP['2'] }}>
          <Input
            label="ニックネーム（2〜20文字）"
            icon={UserIcon}
            value={nickname}
            onChangeText={(v) => {
              setNickname(v);
              if (!touched) setTouched(true);
            }}
            placeholder="例: ぽけオタク"
            maxLength={20}
            autoFocus
            keyboardAppearance="dark"
            selectionColor={C.accent}
          />
          {tooShort && (
            <Text style={[T.caption, { color: C.amber, paddingLeft: SP['1'] }]}>
              あと {2 - trimmed.length} 文字以上必要です
            </Text>
          )}
          {tooLong && (
            <Text style={[T.caption, { color: C.amber, paddingLeft: SP['1'] }]}>
              20 文字までにしてください
            </Text>
          )}
        </View>
        <View style={{ flex: 1 }} />
        <Button
          label="次へ"
          onPress={next}
          loading={saving}
          disabled={!canSubmit}
        />
      </View>
    </KeyboardAvoidingView>
  );
}
