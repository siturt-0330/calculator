import { View, Text, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { BackButton } from '@/components/nav/BackButton';
import { useAuthStore } from '@/stores/authStore';
import { useToastStore } from '@/stores/toastStore';
import { Icon } from '@/constants/icons';

export default function SignupScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { signUp } = useAuthStore();
  const { show } = useToastStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const MailIcon = Icon.at;

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
    const { error } = await signUp(email, password);
    setLoading(false);
    if (error) {
      show('アカウント作成に失敗しました。', 'error');
    } else {
      show('確認メールを送信しました。', 'success');
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
        <View style={{ marginTop: SP['8'], marginBottom: SP['10'] }}>
          <Text style={[T.h1, { color: C.text, marginBottom: SP['2'] }]}>アカウント作成</Text>
          <Text style={[T.body, { color: C.text2 }]}>
            Geek コミュニティへようこそ
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
          />
          <Input
            label="パスワード（8文字以上）"
            value={password}
            onChangeText={setPassword}
            placeholder="パスワード"
            secureTextEntry
          />
        </View>

        <Button label="アカウントを作成" onPress={handleSignup} loading={loading} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
