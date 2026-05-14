import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/stores/authStore';

export default function NotificationsOnboarding() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, setUser } = useAuthStore();

  const finish = () => {
    if (user) setUser({ ...user, onboarded: true });
    router.replace('/(tabs)/feed');
  };

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: C.bg,
        paddingTop: insets.top + SP['8'],
        paddingHorizontal: SP['6'],
        paddingBottom: insets.bottom + SP['6'],
      }}
    >
      <View style={{ flex: 1, gap: SP['4'] }}>
        <View style={{ gap: SP['2'] }}>
          <Text style={[T.h1, { color: C.text }]}>通知を受け取ろう</Text>
          <Text style={[T.body, { color: C.text2 }]}>
            誰が「いいね」したかは通知しません。タグの動向だけお知らせします。
          </Text>
        </View>

        <View
          style={{
            padding: SP['4'],
            backgroundColor: C.bg2,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: C.border,
            gap: SP['3'],
          }}
        >
          {['好きなタグに新着投稿', 'あなたの投稿へのコメント', 'イベント情報'].map((item) => (
            <View key={item} style={{ flexDirection: 'row', gap: SP['3'], alignItems: 'center' }}>
              <Text style={{ color: C.accent, fontSize: 18 }}>✓</Text>
              <Text style={[T.body, { color: C.text }]}>{item}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={{ gap: SP['3'] }}>
        <Button label="通知を許可する" onPress={finish} haptic="success" />
        <Button label="あとで設定する" onPress={finish} variant="ghost" />
      </View>
    </View>
  );
}
