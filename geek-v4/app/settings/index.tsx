import { useState } from 'react';
import { View, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/authStore';
import { TopBar } from '@/components/nav/TopBar';
import { BackButton } from '@/components/nav/BackButton';
import { ListItem } from '@/components/ui/ListItem';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Divider } from '@/components/ui/Divider';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Icon } from '@/constants/icons';
import { C, SP } from '@/design/tokens';
import { TABBAR } from '@/design/tabbar';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signOut } = useAuthStore();
  const [logoutOpen, setLogoutOpen] = useState(false);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="設定" left={<BackButton />} />
      <ScrollView
        contentContainerStyle={{
          paddingBottom: TABBAR.height + insets.bottom + SP['10'],
        }}
      >
        <SectionHeader title="アカウント" />
        <ListItem icon={Icon.edit} label="プロフィール編集" onPress={() => router.push('/settings/profile-edit' as never)} />
        <Divider />
        <ListItem icon={Icon.shield} label="信頼スコア" onPress={() => router.push('/settings/trust-score' as never)} />
        <Divider />
        <ListItem icon={Icon.award} label="プラン" onPress={() => router.push('/settings/plan' as never)} />

        <SectionHeader title="カスタマイズ" />
        <ListItem icon={Icon.bell} label="通知設定" onPress={() => router.push('/settings/notifications' as never)} />
        <Divider />
        <ListItem icon={Icon.hash} label="ブロックするタグ" onPress={() => router.push('/settings/blocked-tags' as never)} />
        <Divider />
        <ListItem icon={Icon.block} label="ブロックしたユーザー" onPress={() => router.push('/settings/blocked-users' as never)} />
        <Divider />
        <ListItem icon={Icon.lock} label="プライバシー" onPress={() => router.push('/settings/privacy' as never)} />

        <SectionHeader title="その他" />
        <ListItem icon={Icon.info} label="このアプリについて" onPress={() => router.push('/settings/about' as never)} />
        <Divider />
        <ListItem icon={Icon.logout} label="ログアウト" onPress={() => setLogoutOpen(true)} destructive />
      </ScrollView>

      <ConfirmDialog
        visible={logoutOpen}
        title="ログアウトしますか？"
        message="再度ログインするにはメールアドレスとパスワードが必要です。"
        confirmLabel="ログアウト"
        cancelLabel="キャンセル"
        destructive
        onCancel={() => setLogoutOpen(false)}
        onConfirm={() => {
          setLogoutOpen(false);
          void signOut();
        }}
      />
    </View>
  );
}
