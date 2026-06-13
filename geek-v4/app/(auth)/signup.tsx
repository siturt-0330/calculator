import { View, Text, KeyboardAvoidingView, Platform, ScrollView, TextInput } from 'react-native';
import { useState, useRef, useEffect } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { BackButton } from '../../components/nav/BackButton';
import { PressableScale } from '../../components/ui/PressableScale';
import { useAuthStore } from '../../stores/authStore';
import { useToastStore } from '../../stores/toastStore';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { Icon } from '../../constants/icons';
import { validatePassword } from '../../lib/passwordPolicy';
import { captureAcquisitionFromUrl, recordAcquisition } from '../../lib/api/acquisition';

// 初回ユーザーの障壁を最小化: 登録は「メール + パスワード」だけ。
//   - 旧 Step2 の電話 (任意) は撤去。
//   - オンボーディング (ようこそ/言語/ニックネーム/好きなタグ/通知) は廃止し、
//     登録成功後そのままフィードへ。ニックネーム/通知はマイページで後から設定する。
//   - ニックネームはサーバが匿名ランダムハンドル (user_xxxxxx) を自動採番 (migration 0146)。
export default function SignupScreen() {
  const params = useLocalSearchParams();
  const presetEmail = typeof params.email === 'string' ? params.email : '';
  const [email, setEmail] = useState(presetEmail);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);
  const signUp = useAuthStore((s) => s.signUp);
  const show = useToastStore((s) => s.show);
  const { online } = useNetworkStatus();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const MailIcon = Icon.at;
  const EyeIcon = showPass ? Icon.eyeOff : Icon.eye;

  // Web: ランディング/サインアップ到達時の URL クエリ(?traffic_source/?utm_*)を退避 (mount 1回)。
  // Native は no-op。実際の記録は signup 成功後の recordAcquisition()。
  useEffect(() => {
    captureAcquisitionFromUrl();
  }, []);

  // 厳しめのメール正規表現 — TLD 2 文字以上必須 (a@b.c など 1 char 弾く)
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const validEmail = (v: string) => EMAIL_RE.test(v);

  const handleSubmit = async () => {
    if (loading) return; // 二重 submit 防止
    if (!validEmail(email.trim())) {
      show('メールアドレスの形式が正しくありません。', 'warn');
      return;
    }
    // 8〜72 文字 + 英字 + 数字 + よくある弱パス排除
    const pwCheck = validatePassword(password);
    if (!pwCheck.ok) {
      show(pwCheck.reason ?? 'パスワードがセキュリティ要件を満たしていません。', 'warn');
      return;
    }
    // 確認用パスワードと一致するか (打ち間違いによる即ロックアウトを防ぐ)
    if (password !== confirmPassword) {
      show('パスワードが一致しません。もう一度ご確認ください。', 'warn');
      return;
    }
    if (!online) {
      show('オフラインです。インターネット接続を確認してください。', 'error');
      return;
    }
    setLoading(true);
    const result = await signUp(email.trim(), password, '');
    setLoading(false);
    if (result.error) {
      let msg = 'アカウント作成に失敗しました。';
      const err = result.error.toLowerCase();
      // 1) 既に登録済み (user_already_exists / "User already registered")
      if (err.includes('already registered') || err.includes('user already') || err.includes('already_exists')) {
        show('このメールアドレスは既に登録済みです。ログインしてください。', 'warn');
        router.replace({ pathname: '/(auth)/login', params: { email: email.trim() } } as never);
        return;
      // 2) メール形式 (validation_failed / "Unable to validate email address")
      } else if (err.includes('validate email') || err.includes('invalid format') || err.includes('valid email')) {
        msg = 'メールアドレスの形式が正しくありません。';
      // 3) パスワード弱い (weak_password / "Password should be at least N characters")
      } else if (err.includes('password') || err.includes('weak')) {
        msg = 'パスワードがセキュリティ要件を満たしていません。';
      // 4) レート制限
      } else if (err.includes('rate') || err.includes('too many')) {
        msg = '短時間に試行しすぎました。少し待ってから再度お試しください。';
      // 5) ネットワーク
      } else if (err.includes('network') || err.includes('ネットワーク')) {
        msg = 'ネットワークエラー。接続を確認してください。';
      }
      show(msg, 'error');
      return;
    }
    if (result.autoLoggedIn) {
      show('アカウントを作成しました！', 'success');
      // 流入元(traffic_source/utm)を user_acquisition へ記録 — fire-and-forget (体験を止めない)。
      // autoLoggedIn 時のみ auth.uid() が確定するので、ここで記録する。
      void recordAcquisition();
      // ★ 2026-06-13: 登録直後にテーマ (ダーク/ライト/システム) を 1 度だけ選んでもらう。
      //   旧オンボの 5 画面ウィザードは廃止のままで、これだけ薄く挟む。
      //   replace なので戻るで signup には戻らない。
      router.replace('/welcome-theme' as never);
    } else if (result.needsConfirmEmail) {
      show('確認メールを送信しました。リンクをクリックしてからログインしてください。', 'success');
      router.replace('/(auth)/login');
    } else {
      show('登録完了。ログインしてください。', 'success');
      router.replace('/(auth)/login');
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: C.bg }}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: insets.top + SP['4'],
          paddingBottom: insets.bottom + SP['6'],
          paddingHorizontal: SP['6'],
        }}
        keyboardShouldPersistTaps="handled"
      >
        <BackButton />

        <View style={{ marginTop: SP['6'], marginBottom: SP['6'] }}>
          <Text style={[T.h1, { color: C.text, marginBottom: SP['2'] }]}>アカウントを作成</Text>
          <Text style={[T.body, { color: C.text2 }]}>
            メールとパスワードだけで、すぐに始められます。
          </Text>
        </View>

        <View style={{ gap: SP['4'], marginBottom: SP['5'] }}>
          <Input
            label="メールアドレス"
            icon={MailIcon}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
            autoFocus
            keyboardAppearance="dark"
            selectionColor={C.accent}
            // RFC 5321 上限 (memory DoS 対策)
            maxLength={254}
          />
          <Input
            ref={passwordRef}
            label="パスワード（8 - 72 文字 / 英字+数字）"
            value={password}
            onChangeText={setPassword}
            placeholder="パスワード"
            secureTextEntry={!showPass}
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="next"
            onSubmitEditing={() => confirmRef.current?.focus()}
            keyboardAppearance="dark"
            selectionColor={C.accent}
            // bcrypt 上限 72 文字 + 余裕 (memory DoS 対策)
            maxLength={128}
            right={
              <PressableScale
                onPress={() => setShowPass((v) => !v)}
                haptic="tap"
                hitSlop={14}
                accessibilityLabel={showPass ? 'パスワードを非表示にする' : 'パスワードを表示する'}
                accessibilityRole="button"
              >
                <EyeIcon size={20} color={C.text3} strokeWidth={2.2} />
              </PressableScale>
            }
          />
          {/* 確認用パスワード — 打ち間違いによる即ロックアウト防止 */}
          <Input
            ref={confirmRef}
            label="パスワード（確認）"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="もう一度入力"
            secureTextEntry={!showPass}
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="go"
            onSubmitEditing={handleSubmit}
            keyboardAppearance="dark"
            selectionColor={C.accent}
            maxLength={128}
          />
        </View>

        {/* 利用規約・プライバシー同意 — アカウント作成 (登録) の直前に明示 */}
        <Text style={[T.caption, { color: C.text3, textAlign: 'center', lineHeight: 18 }]}>
          「登録」を押すと、
          <Text onPress={() => router.push('/settings/terms' as never)} style={{ color: C.accent, fontWeight: '700' }}>利用規約</Text>
          と
          <Text onPress={() => router.push('/settings/privacy-policy' as never)} style={{ color: C.accent, fontWeight: '700' }}>プライバシーポリシー</Text>
          に同意したものとみなします。
        </Text>

        <View style={{ marginTop: SP['4'] }}>
          <Button label="登録" onPress={handleSubmit} loading={loading} disabled={loading} />
        </View>

        <View style={{ alignItems: 'center', marginTop: SP['4'] }}>
          <PressableScale onPress={() => router.replace('/(auth)/login' as never)} haptic="tap">
            <Text style={[T.small, { color: C.text3 }]}>
              既にアカウントをお持ちですか？ <Text style={{ color: C.accent, fontWeight: '700' }}>ログイン</Text>
            </Text>
          </PressableScale>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
