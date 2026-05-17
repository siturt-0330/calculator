import { View, Text, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useState } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, R, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { BackButton } from '@/components/nav/BackButton';
import { PressableScale } from '@/components/ui/PressableScale';
import { useAuthStore } from '@/stores/authStore';
import { useToastStore } from '@/stores/toastStore';
import { Icon } from '@/constants/icons';

type Step = 'phone' | 'credentials';

export default function SignupScreen() {
  const params = useLocalSearchParams();
  const presetEmail = typeof params.email === 'string' ? params.email : '';
  const [step, setStep] = useState<Step>(presetEmail ? 'credentials' : 'phone');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState(presetEmail);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const { signUp } = useAuthStore();
  const { show } = useToastStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const MailIcon = Icon.at;
  const PhoneIcon = Icon.phone;
  const EyeIcon = showPass ? Icon.eyeOff : Icon.eye;

  const goNext = () => {
    if (!phone) {
      show('電話番号を入力してください。', 'warn');
      return;
    }
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 11) {
      show('電話番号を正しく入力してください。', 'warn');
      return;
    }
    setStep('credentials');
  };

  const handleSignup = async () => {
    if (!email || !password) {
      show('メールアドレスとパスワードを入力してください。', 'warn');
      return;
    }
    if (password.length < 8) {
      show('パスワードは8文字以上で設定してください。', 'warn');
      return;
    }
    setLoading(true);
    const result = await signUp(email.trim(), password, phone.trim());
    setLoading(false);
    if (result.error) {
      let msg = 'アカウント作成に失敗しました。';
      if (result.error.includes('already registered') || result.error.includes('User already')) {
        msg = 'このメールアドレスは既に登録されています。ログインしてください。';
      } else if (result.error.includes('valid email')) {
        msg = 'メールアドレスの形式が正しくありません。';
      } else if (result.error.includes('Password')) {
        msg = 'パスワードは8文字以上で設定してください。';
      }
      show(msg, 'error');
      return;
    }
    if (result.autoLoggedIn) {
      show('アカウントを作成しました！', 'success');
      router.replace('/onboarding');
    } else if (result.needsConfirmEmail) {
      show('確認メールを送信しました。', 'success');
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
        <BackButton onPress={step === 'credentials' ? () => setStep('phone') : undefined} />

        {/* ステップインジケーター */}
        <View style={{ flexDirection: 'row', gap: SP['1'], marginTop: SP['4'] }}>
          <View style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: C.accent }} />
          <View style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: step === 'credentials' ? C.accent : C.bg3 }} />
        </View>
        <Text style={[T.caption, { color: C.text3, marginTop: SP['1'] }]}>
          ステップ {step === 'phone' ? '1' : '2'} / 2
        </Text>

        {step === 'phone' ? (
          <>
            <View style={{ marginTop: SP['6'], marginBottom: SP['8'] }}>
              <Text style={[T.h1, { color: C.text, marginBottom: SP['2'] }]}>電話番号を入力</Text>
              <Text style={[T.body, { color: C.text2 }]}>
                アカウントの安全のため、まず電話番号を登録します。
                {'\n'}非公開で、他のユーザーには表示されません。
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
            />

            <View style={{ marginTop: SP['8'] }}>
              <Button label="次へ" onPress={goNext} />
            </View>
          </>
        ) : (
          <>
            <View style={{ marginTop: SP['6'], marginBottom: SP['8'] }}>
              <Text style={[T.h1, { color: C.text, marginBottom: SP['2'] }]}>メール＆パスワード</Text>
              <Text style={[T.body, { color: C.text2 }]}>
                ログイン用の情報を設定してください。
              </Text>
            </View>

            <View style={{ gap: SP['4'], marginBottom: SP['8'] }}>
              <Input
                label="メールアドレス"
                icon={MailIcon}
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
              />
              <Input
                label="パスワード（8文字以上）"
                value={password}
                onChangeText={setPassword}
                placeholder="パスワード"
                secureTextEntry={!showPass}
                right={
                  <PressableScale onPress={() => setShowPass((v) => !v)} haptic="tap">
                    <EyeIcon size={18} color={C.text3} strokeWidth={2.2} />
                  </PressableScale>
                }
              />
            </View>

            <Button label="アカウントを作成" onPress={handleSignup} loading={loading} />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
