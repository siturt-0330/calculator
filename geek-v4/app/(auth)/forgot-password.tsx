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

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const { show } = useToastStore();
  const insets = useSafeAreaInsets();
  const MailIcon = Icon.at;

  const handleReset = async () => {
    if (!email) return;
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    setLoading(false);
    if (error) {
      show('送信に失敗しました。', 'error');
    } else {
      show('パスワードリセットメールを送信しました。', 'success');
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
          onChangeText={setEmail}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <Button label="送信" onPress={handleReset} loading={loading} />
      </View>
    </KeyboardAvoidingView>
  );
}
