import { View, Text, KeyboardAvoidingView, Platform } from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Icon } from '@/constants/icons';

export default function NicknameScreen() {
  const [nickname, setNickname] = useState('');
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const UserIcon = Icon.mypage;

  const next = () => {
    if (nickname.trim().length < 2) return;
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
        <Input
          label="ニックネーム（2〜20文字）"
          icon={UserIcon}
          value={nickname}
          onChangeText={setNickname}
          placeholder="例: ぽけオタク"
          maxLength={20}
          autoFocus
        />
        <View style={{ flex: 1 }} />
        <Button
          label="次へ"
          onPress={next}
          disabled={nickname.trim().length < 2}
        />
      </View>
    </KeyboardAvoidingView>
  );
}
