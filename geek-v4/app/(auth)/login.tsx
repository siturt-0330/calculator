import { View, Text, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useState } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, R, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PressableScale } from '@/components/ui/PressableScale';
import { useAuthStore } from '@/stores/authStore';
import { useToastStore } from '@/stores/toastStore';
import { Icon } from '@/constants/icons';

export default function LoginScreen() {
  const params = useLocalSearchParams();
  const presetEmail = typeof params.email === 'string' ? params.email : '';
  const [email, setEmail] = useState(presetEmail);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [credErrorBanner, setCredErrorBanner] = useState(false);
  const { signIn } = useAuthStore();
  const { show } = useToastStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const EyeIcon = showPass ? Icon.eyeOff : Icon.eye;
  const MailIcon = Icon.at;

  const handleLogin = async () => {
    if (loading) return;  // 二重 submit 防止
    // 入力チェック (trim も含めて空判定)
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      show('メールアドレスとパスワードを入力してください。', 'warn');
      return;
    }
    if (!/\S+@\S+\.\S+/.test(trimmedEmail)) {
      show('メールアドレスの形式が正しくありません。', 'warn');
      return;
    }
    setLoading(true);
    setCredErrorBanner(false);
    // 最終安全タイマー: 15秒経っても応答が無ければ loading 解除
    const safety = setTimeout(() => {
      setLoading(false);
      show('応答がありません。もう一度お試しください。', 'error');
    }, 15000);
    let result;
    try {
      result = await signIn(trimmedEmail, password);
    } finally {
      clearTimeout(safety);
      setLoading(false);
    }
    if (result.error) {
      if (result.error.includes('Invalid login credentials')) {
        // Supabase はセキュリティ上「未登録」と「パスワード違い」を区別しないので
        // 中立的なメッセージにする。バナーで両方のリカバリ手段を提示。
        setCredErrorBanner(true);
        show('メールアドレスまたはパスワードが違います。', 'warn');
      } else if (result.error.includes('Email not confirmed')) {
        show('確認メールのリンクをクリックしてからログインしてください。', 'error');
      } else if (result.error.includes('Too many') || result.error.includes('rate')) {
        show('短時間に試行しすぎました。少し待ってから再度お試しください。', 'warn');
      } else if (result.error.includes('network') || result.error.includes('Network') || result.error.includes('ネットワーク')) {
        show('ネットワークエラー。接続を確認してください。', 'error');
      } else {
        show('ログインに失敗しました: ' + result.error, 'error');
      }
      return;
    }
    if (result.next === 'onboarding') {
      router.replace('/onboarding');
    } else {
      router.replace('/(tabs)/feed');
    }
  };

  const goToSignup = () => {
    // 入力内容を保持したまま signup へ
    router.push({ pathname: '/(auth)/signup', params: { email: email.trim() } } as never);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: C.bg }}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: insets.top + SP['10'],
          paddingBottom: insets.bottom + SP['6'],
          paddingHorizontal: SP['6'],
          justifyContent: 'center',
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ marginBottom: SP['6'] }}>
          <Text style={[T.display, { color: C.text, marginBottom: SP['2'] }]}>Geek</Text>
          <Text style={[T.body, { color: C.text2 }]}>好きを、匿名で、安心して続ける。</Text>
        </View>

        {/* ログイン失敗バナー */}
        {credErrorBanner && (
          <View style={{
            padding: SP['4'],
            backgroundColor: C.amberBg,
            borderRadius: R.lg,
            borderWidth: 1,
            borderColor: C.amber + '66',
            marginBottom: SP['4'],
            gap: SP['2'],
          }}>
            <Text style={[T.bodyMd, { color: C.amber, fontWeight: '700' }]}>
              ログインできませんでした
            </Text>
            <Text style={[T.small, { color: C.text2 }]}>
              メールアドレスとパスワードを確認してください。アカウントをまだお持ちでない場合は新規登録してください。
            </Text>
            <View style={{ flexDirection: 'row', gap: SP['2'], marginTop: SP['1'] }}>
              <PressableScale
                onPress={() => router.push('/(auth)/forgot-password' as never)}
                haptic="tap"
                style={{ flex: 1, padding: SP['2'], borderRadius: R.md, borderWidth: 1, borderColor: C.border, alignItems: 'center' }}
              >
                <Text style={[T.smallM, { color: C.text }]}>パスワード再設定</Text>
              </PressableScale>
              <PressableScale
                onPress={goToSignup}
                haptic="confirm"
                style={{ flex: 1, padding: SP['2'], borderRadius: R.md, backgroundColor: C.accent, alignItems: 'center' }}
              >
                <Text style={[T.smallM, { color: '#fff', fontWeight: '700' }]}>新規登録</Text>
              </PressableScale>
            </View>
          </View>
        )}

        <View style={{ gap: SP['4'], marginBottom: SP['6'] }}>
          <Input
            label="メールアドレス"
            icon={MailIcon}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardAppearance="dark"
            selectionColor={C.accent}
          />
          <Input
            label="パスワード"
            value={password}
            onChangeText={setPassword}
            placeholder="パスワード"
            secureTextEntry={!showPass}
            keyboardAppearance="dark"
            selectionColor={C.accent}
            right={
              <PressableScale onPress={() => setShowPass((v) => !v)} haptic="tap">
                <EyeIcon size={18} color={C.text3} strokeWidth={2.2} />
              </PressableScale>
            }
          />
        </View>

        <View style={{ gap: SP['3'] }}>
          <Button label="ログイン" onPress={handleLogin} loading={loading} />
          <Button
            label="アカウントを作成"
            onPress={() => router.push('/(auth)/signup')}
            variant="ghost"
          />
        </View>

        <PressableScale
          onPress={() => router.push('/(auth)/forgot-password')}
          style={{ alignItems: 'center', marginTop: SP['6'] }}
          haptic="tap"
        >
          <Text style={[T.small, { color: C.text3 }]}>パスワードを忘れた方</Text>
        </PressableScale>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
