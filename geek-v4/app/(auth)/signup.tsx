import { View, Text, KeyboardAvoidingView, Platform, ScrollView, Keyboard, TextInput } from 'react-native';
import { useState, useRef } from 'react';
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

// 初回ユーザーの障壁を最小化するため、
//   - ステップ 1: メール + パスワード (必須)
//   - ステップ 2: 電話番号 (任意、スキップで進める)
// に再構成。匿名 SNS のコンセプトに沿って phone は optional に。
type Step = 'credentials' | 'phone';

export default function SignupScreen() {
  const params = useLocalSearchParams();
  const presetEmail = typeof params.email === 'string' ? params.email : '';
  const [step, setStep] = useState<Step>('credentials');
  const [email, setEmail] = useState(presetEmail);
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const passwordRef = useRef<TextInput>(null);
  const signUp = useAuthStore((s) => s.signUp);
  const show = useToastStore((s) => s.show);
  const { online } = useNetworkStatus();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const MailIcon = Icon.at;
  const PhoneIcon = Icon.phone;
  const EyeIcon = showPass ? Icon.eyeOff : Icon.eye;

  // 厳しめのメール正規表現 — TLD 2 文字以上必須 (a@b.c など 1 char 弾く)
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const validEmail = (v: string) => EMAIL_RE.test(v);

  const goToPhoneStep = () => {
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
    // ステップ切替前にキーボードを閉じる (iOS でジャンクなアニメ防止)
    Keyboard.dismiss();
    setStep('phone');
  };

  const submitSignup = async (phoneInput: string) => {
    if (loading) return;  // 二重 submit 防止
    if (!online) {
      show('オフラインです。インターネット接続を確認してください。', 'error');
      return;
    }
    setLoading(true);
    const result = await signUp(email.trim(), password, phoneInput.trim());
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
      router.replace('/onboarding');
    } else if (result.needsConfirmEmail) {
      show('確認メールを送信しました。リンクをクリックしてからログインしてください。', 'success');
      router.replace('/(auth)/login');
    } else {
      show('登録完了。ログインしてください。', 'success');
      router.replace('/(auth)/login');
    }
  };

  const handleSkipPhone = () => {
    // 電話番号入力済みでスキップする時は warning toast を表示しつつそのまま登録
    // 旧実装はタップを 2 回必要にしていたが、phone を空にしてもボタンラベルが
    // 変わらないので「効いてないのでは？」という誤解を招いていた。
    const digits = phone.replace(/\D/g, '');
    if (digits.length > 0) {
      show('電話番号なしで登録します。', 'info');
    }
    submitSignup('');
  };
  const handleSubmitWithPhone = () => {
    const digits = phone.replace(/\D/g, '');
    // 電話番号入れた人だけチェック (空ならスキップ扱い)
    if (digits.length > 0) {
      if (digits.length < 10 || digits.length > 15) {
        show('電話番号の形式が正しくありません。', 'warn');
        return;
      }
      // E.164 風にサニタイズ: 日本の番号なら先頭 0 → +81 に変換、それ以外は + 接頭辞があれば保持
      // ただしユーザーの入力意図を尊重して、明確に変な文字列だけ拒否
      if (!/^[+0-9\s\-()]+$/.test(phone)) {
        show('電話番号には数字 / + / - / () / 空白以外を含めないでください。', 'warn');
        return;
      }
    }
    // submitSignup には digits だけ (整形済) を渡す — 表記揺れを統一
    submitSignup(digits);
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
        <BackButton onPress={step === 'phone' ? () => setStep('credentials') : undefined} />

        {/* ステップインジケーター */}
        <View style={{ flexDirection: 'row', gap: SP['1'], marginTop: SP['4'] }}>
          <View style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: C.accent }} />
          <View style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: step === 'phone' ? C.accent : C.bg3 }} />
        </View>
        <Text style={[T.caption, { color: C.text3, marginTop: SP['1'] }]}>
          ステップ {step === 'credentials' ? '1' : '2'} / 2
        </Text>

        {step === 'credentials' ? (
          <>
            <View style={{ marginTop: SP['6'], marginBottom: SP['6'] }}>
              <Text style={[T.h1, { color: C.text, marginBottom: SP['2'] }]}>アカウントを作成</Text>
              <Text style={[T.body, { color: C.text2 }]}>
                メールとパスワードでログインできるようにします。
              </Text>
            </View>

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
                returnKeyType="go"
                onSubmitEditing={goToPhoneStep}
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
            </View>

            <Button label="次へ" onPress={goToPhoneStep} />

            <View style={{ alignItems: 'center', marginTop: SP['4'] }}>
              <PressableScale onPress={() => router.replace('/(auth)/login' as never)} haptic="tap">
                <Text style={[T.small, { color: C.text3 }]}>
                  既にアカウントをお持ちですか？ <Text style={{ color: C.accent, fontWeight: '700' }}>ログイン</Text>
                </Text>
              </PressableScale>
            </View>
          </>
        ) : (
          <>
            <View style={{ marginTop: SP['6'], marginBottom: SP['6'] }}>
              <Text style={[T.h1, { color: C.text, marginBottom: SP['2'] }]}>電話番号 (任意)</Text>
              <Text style={[T.body, { color: C.text2 }]}>
                登録すると、パスワードを忘れた時の復旧やセキュリティ通知に使われます。
                {'\n'}他のユーザーには公開されません。
              </Text>
            </View>

            <Input
              label="電話番号"
              icon={PhoneIcon}
              value={phone}
              onChangeText={setPhone}
              placeholder="090-0000-0000"
              keyboardType="phone-pad"
              autoFocus
              keyboardAppearance="dark"
              selectionColor={C.accent}
              // 国際電話 + 記号 + 余裕 (E.164 で max 15 桁 / memory DoS 対策)
              maxLength={32}
            />

            <View style={{ marginTop: SP['8'], gap: SP['3'] }}>
              <Button
                label="登録"
                onPress={handleSubmitWithPhone}
                loading={loading}
                disabled={loading}
              />
              <Button
                label="スキップして登録"
                onPress={handleSkipPhone}
                variant="ghost"
                disabled={loading}
              />
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
