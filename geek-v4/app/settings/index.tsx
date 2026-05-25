import { useState } from 'react';
import { View, ScrollView, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../stores/authStore';
import { useIntroStore } from '../../stores/introStore';
import { useLanguageStore, LANG_OPTIONS } from '../../stores/languageStore';
import { useIsAdmin } from '../../hooks/useAdmin';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { ListItem } from '../../components/ui/ListItem';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { Divider } from '../../components/ui/Divider';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Icon } from '../../constants/icons';
import { C, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { TABBAR } from '../../design/tabbar';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signOut } = useAuthStore();
  const isAdmin = useIsAdmin();
  const playIntro = useIntroStore((s) => s.play);
  const [logoutOpen, setLogoutOpen] = useState(false);
  // 現在言語を chip 表示する → 「気付かないうちに別言語になってる」事故を視覚的に防ぐ
  const lang = useLanguageStore((s) => s.lang);
  const langOption = LANG_OPTIONS.find((o) => o.code === lang);

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
        <ListItem
          icon={Icon.globe}
          label="言語"
          onPress={() => router.push('/settings/language' as never)}
          right={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
              <Text style={[T.small, { color: C.text2 }]} numberOfLines={1}>
                {langOption ? `${langOption.flag} ${langOption.native}` : lang}
              </Text>
              <Icon.chevronR size={18} color={C.text3} strokeWidth={2.2} />
            </View>
          }
        />
        <Divider />
        <ListItem icon={Icon.bell} label="通知設定" onPress={() => router.push('/settings/notifications' as never)} />
        <Divider />
        <ListItem icon={Icon.sparkles} label="おすすめ・自動化" onPress={() => router.push('/settings/recommendations' as never)} />
        <Divider />
        <ListItem icon={Icon.hash} label="ブロックするタグ" onPress={() => router.push('/settings/blocked-tags' as never)} />
        <Divider />
        <ListItem icon={Icon.block} label="ブロックしたユーザー" onPress={() => router.push('/settings/blocked-users' as never)} />
        <Divider />
        <ListItem icon={Icon.lock} label="プライバシー" onPress={() => router.push('/settings/privacy' as never)} />
        <Divider />
        <ListItem icon={Icon.shield} label="データとアカウント" onPress={() => router.push('/settings/account' as never)} />

        {isAdmin && (
          <>
            <SectionHeader title="管理" />
            <ListItem icon={Icon.shield} label="📊 フィードバック管理" onPress={() => router.push('/settings/feedback-admin' as never)} />
          </>
        )}

        <SectionHeader title="その他" />
        <ListItem icon={Icon.sparkles} label="起動アニメーションを再生" onPress={playIntro} />
        <Divider />
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
