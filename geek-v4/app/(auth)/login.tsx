import { View, Text, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, SP, R } from '@/design/tokens';
import { T } from '@/design/typography';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PressableScale } from '@/components/ui/PressableScale';
import { useAuthStore } from '@/stores/authStore';
import { useToastStore } from '@/stores/toastStore';
import { Icon } from '@/constants/icons';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const { signIn } = useAuthStore();
  const { show } = useToastStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const EyeIcon = showPass ? Icon.eyeOff : Icon.eye;
  const MailIcon = Icon.at;

  const handleLogin = async () => {
    if (!email || !password) {
      show('メールアドレスとパスワードを入力してください。', 'warn');
      return;
    }
    setLoading(true);
    const { error } = await signIn(email, password);
    setLoading(false);
    if (error) {
      show('ログインに失敗しました。入力内容を確認してください。', 'error');
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
          paddingTop: insets.top + SP['10'],
          paddingBottom: insets.bottom + SP['6'],
          paddingHorizontal: SP['6'],
          justifyContent: 'center',
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ marginBottom: SP['10'] }}>
          <Text style={[T.display, { color: C.text, marginBottom: SP['2'] }]}>Geek</Text>
          <Text style={[T.body, { color: C.text2 }]}>好きを、匿名で、安心して続ける</Text>
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
          />
          <Input
            label="パスワード"
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
