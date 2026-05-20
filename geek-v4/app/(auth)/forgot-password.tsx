import { View, Text, KeyboardAvoidingView, Platform } from 'react-native';
import { useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { BackButton } from '@/components/nav/BackButton';
import { supabase } from '@/lib/supabase';
import { useToastStore } from '@/stores/toastStore';
import { Icon } from '@/constants/icons';

// パスワードリセット完了画面の URL を組み立てる。
//   - Web: 現在の origin + /reset-password (Netlify SPA fallback で OK)
//   - Native: scheme://reset-password — Supabase ダッシュボードの
//     Authentication → URL Configuration → Redirect URLs に登録が必要。
//
// 重要: ここの URL が Supabase ダッシュボードの "Redirect URLs" に登録されて
// いないと、メール内のリンクは無効化される。
function buildResetRedirectUrl(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return `${window.location.origin}/reset-password`;
  }
  // Native: app.json の "scheme": "geek" を使う
  return 'geek://reset-password';
}

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const { show } = useToastStore();
  const insets = useSafeAreaInsets();
  const MailIcon = Icon.at;

  const handleReset = async () => {
    const e = email.trim();
    if (!/\S+@\S+\.\S+/.test(e)) {
      show('メールアドレスの形式が正しくありません。', 'warn');
      return;
    }
    if (loading) return;
    setLoading(true);
    const redirectTo = buildResetRedirectUrl();
    const { error } = await supabase.auth.resetPasswordForEmail(e, { redirectTo });
    setLoading(false);
    if (error) {
      show('送信に失敗しました。時間をおいて再度お試しください。', 'error');
    } else {
      // セキュリティ上、メールが登録されているかは伝えない
      setSent(true);
      show('もしそのメールが登録済みなら、リセットメールが届きます。', 'success');
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: C.bg }}
    >
      <View
        style={{
          flex: 1,
          paddingTop: insets.top + SP['4'],
          paddingHorizontal: SP['6'],
          gap: SP['6'],
        }}
      >
        <BackButton />
        <View style={{ gap: SP['2'] }}>
          <Text style={[T.h1, { color: C.text }]}>パスワードリセット</Text>
          <Text style={[T.body, { color: C.text2 }]}>
            登録済みのメールアドレスにリセットリンクを送信します。
          </Text>
        </View>
        <Input
          label="メールアドレス"
          icon={MailIcon}
          value={email}
          onChangeText={(t) => {
            setEmail(t);
            if (sent) setSent(false);
          }}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          keyboardAppearance="dark"
          selectionColor={C.accent}
        />
        <Button label={sent ? '再送信' : '送信'} onPress={handleReset} loading={loading} />
        {sent && (
          <Text style={[T.small, { color: C.text3, textAlign: 'center', lineHeight: 18 }]}>
            メールが届かない場合は迷惑メールフォルダもご確認ください。{'\n'}
            リンクは 1 時間で期限切れになります。
          </Text>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
