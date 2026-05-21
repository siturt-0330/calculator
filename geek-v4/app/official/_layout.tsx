// ============================================================
// geek-official — 公式コミュニティ管理者向けゲート
// ============================================================
// 自分が `communities.official_admin_user_id` に設定されているコミュ
// が一つも無ければ /(tabs)/feed に飛ばす。書き込みは RLS でも守る。
// ============================================================
import { useEffect } from 'react';
import { View } from 'react-native';
import { Stack, Redirect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../../stores/authStore';
import { useToastStore } from '../../stores/toastStore';
import { fetchMyOfficialCommunities } from '../../lib/api/officialCommunities';
import { C } from '../../design/tokens';
import { Spinner } from '../../components/ui/Spinner';

export default function OfficialLayout() {
  const user = useAuthStore((s) => s.user);
  const { show } = useToastStore();

  const { data, isLoading } = useQuery({
    queryKey: ['my-official-communities', user?.id],
    queryFn: fetchMyOfficialCommunities,
    enabled: !!user,
    staleTime: 60_000,
  });

  // ログイン無し → root layout 側で /(auth)/login にリダイレクトされる想定だが、
  // この層でも保険として feed に逃がす。
  useEffect(() => {
    if (!isLoading && data && data.length === 0) {
      show('公式コミュニティを管理していません', 'warn');
    }
  }, [data, isLoading, show]);

  if (!user) {
    return <Redirect href={'/(auth)/login' as never} />;
  }
  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Spinner size="large" />
      </View>
    );
  }
  if (!data || data.length === 0) {
    return <Redirect href={'/(tabs)/feed' as never} />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: C.bg },
        animation: 'slide_from_right',
        animationDuration: 220,
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="[communityId]/index" />
      <Stack.Screen name="[communityId]/post" />
      <Stack.Screen name="[communityId]/knowledge" />
      <Stack.Screen name="[communityId]/events" />
      <Stack.Screen name="[communityId]/spots" />
      <Stack.Screen name="[communityId]/analytics" />
    </Stack>
  );
}
