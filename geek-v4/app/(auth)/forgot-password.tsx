import { View, Text, KeyboardAvoidingView, Platform } from 'react-native';
import { useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { BackButton } from '../../components/nav/BackButton';
import { supabase } from '../../lib/supabase';
import { useToastStore } from '../../stores/toastStore';
import { Icon } from '../../constants/icons';

// パスワードリセット完了画面の URL を組み立てる。
//   - Web: 現在の origin + /reset-password (Netlify SPA fallback で OK)
//   - Native: Universal Links (https://geek.app/reset-password) を使う
//     iOS: associatedDomains "applinks:geek.app" (app.json で設定済)
//     Android: intentFilters の autoVerify + assetlinks.json (docs/UNIVERSAL_LINKS.md)
//
// 旧実装は geek:// scheme を使っていたが、悪意あるアプリが同じ scheme を
// 登録するとリカバリ token を奪われる (URL scheme hijacking) ため、
// HTTPS の Universal Links / App Links に統一する。
//
// 重要: 同じ URL が Supabase ダッシュボードの
// Authentication → URL Configuration → Redirect URLs に登録されている必要がある:
//   - https://geek.app/reset-password
//   - http://localhost:8081/reset-password (開発用)
//   - https://*.geek.app/reset-password (preview)
function buildResetRedirectUrl(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return `${window.location.origin}/reset-password`;
  }
  // Native: Universal Links / App Links 経由で web 版に着地。
  // 端末に Geek アプリがインストールされていれば自動的にアプリで開かれる
  // (Associated Domains / Digital Asset Links により検証された場合のみ)。
  return 'https://geek.app/reset-password';
}

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const show = useToastStore((s) => s.show);
  const insets = useSafeAreaInsets();
  const MailIcon = Icon.at;

  const handleReset = async () => {
    // 二重 submit 防止は最初に — 検証より前
    if (loading) return;
    const e = email.trim();
    if (!/\S+@\S+\.\S+/.test(e)) {
      show('メールアドレスの形式が正しくありません。', 'warn');
      return;
    }
    setLoading(true);
    const redirectTo = buildResetRedirectUrl();
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(e, { redirectTo });
      if (error) {
        show('送信に失敗しました。時間をおいて再度お試しください。', 'error');
      } else {
        // セキュリティ上、メールが登録されているかは伝えない
        setSent(true);
        show('もしそのメールが登録済みなら、リセットメールが届きます。', 'success');
      }
    } catch {
      // ネットワーク例外でも loading が解除されるよう catch を必ず通す
      show('送信に失敗しました。回線を確認してください。', 'error');
    } finally {
      setLoading(false);
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
          // RFC 5321 上限 (memory DoS 対策)
          maxLength={254}
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
