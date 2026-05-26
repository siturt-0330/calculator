import { useState } from 'react';
import { View, ScrollView, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../../stores/authStore';
import { useIntroStore } from '../../stores/introStore';
import { useLanguageStore, LANG_OPTIONS } from '../../stores/languageStore';
import { useIsAdmin } from '../../hooks/useAdmin';
import { supabase } from '../../lib/supabase';
import { fetchMyOfficialCommunities } from '../../lib/api/officialCommunities';
import type { Community } from '../../lib/api/communities';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { ListItem } from '../../components/ui/ListItem';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { Divider } from '../../components/ui/Divider';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Icon } from '../../constants/icons';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { TABBAR } from '../../design/tabbar';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const isAdmin = useIsAdmin();
  const playIntro = useIntroStore((s) => s.play);
  const [logoutOpen, setLogoutOpen] = useState(false);
  // 現在言語を chip 表示する → 「気付かないうちに別言語になってる」事故を視覚的に防ぐ
  const lang = useLanguageStore((s) => s.lang);
  const langOption = LANG_OPTIONS.find((o) => o.code === lang);

  // 運営からの未読メッセージ件数 — 「あなたの活動」セクションの数字バッジ用。
  // 同じ queryKey を messages.tsx 側 + mypage 側 (旧) でも使うため、既読化で即減る。
  const { data: unreadAdminMessages = 0 } = useQuery<number>({
    queryKey: ['admin-messages-unread-count', user?.id],
    queryFn: async () => {
      if (!user) return 0;
      const { count, error } = await supabase
        .from('admin_messages')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_id', user.id)
        .is('read_at', null);
      if (error) return 0;
      return count ?? 0;
    },
    enabled: !!user,
    staleTime: 60_000,
  });

  // 公式コミュ管理者の場合のみ「Geek Official」行を出す
  const { data: officialCommunities = [] } = useQuery<Community[]>({
    queryKey: ['my-official-communities', user?.id],
    queryFn: fetchMyOfficialCommunities,
    enabled: !!user,
    staleTime: 60_000,
  });
  const hasOfficial = officialCommunities.length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="設定" left={<BackButton />} />
      <ScrollView
        contentContainerStyle={{
          paddingBottom: TABBAR.height + insets.bottom + SP['10'],
        }}
      >
        {/* ───────── あなたの活動 (旧 mypage アクティビティから移設) ───────── */}
        <SectionHeader title="あなたの活動" />
        <ListItem icon={Icon.edit} label="自分の投稿" onPress={() => router.push('/mypage/posts' as never)} />
        <Divider />
        <ListItem icon={Icon.heart} label="いいねした投稿" onPress={() => router.push('/mypage/liked' as never)} />
        <Divider />
        <ListItem icon={Icon.save} label="保存した投稿" onPress={() => router.push('/mypage/saved' as never)} />
        <Divider />
        <ListItem
          icon={Icon.send}
          label="運営からのメッセージ"
          right={unreadAdminMessages > 0 ? <CountPill text={String(unreadAdminMessages)} /> : undefined}
          onPress={() => router.push('/mypage/messages' as never)}
        />
        {hasOfficial && (
          <>
            <Divider />
            <ListItem
              icon={Icon.shield}
              label="Geek Official"
              right={<CountPill text={String(officialCommunities.length)} accent />}
              onPress={() => router.push('/official' as never)}
            />
          </>
        )}

        <SectionHeader title="アカウント" />
        <ListItem icon={Icon.edit} label="プロフィール編集" onPress={() => router.push('/settings/profile-edit' as never)} />
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

// 件数バッジ — accent=true で primary 色、false で red (未読の重要さ示す)
function CountPill({ text, accent = false }: { text: string; accent?: boolean }) {
  return (
    <View
      style={{
        minWidth: 22,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: R.full,
        backgroundColor: accent ? C.accentBg : C.redBg,
        borderWidth: 1,
        borderColor: accent ? C.accentSoft : C.red + '44',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          fontSize: 11,
          fontWeight: '700',
          color: accent ? C.accentLight : C.red,
          letterSpacing: 0.3,
        }}
      >
        {text}
      </Text>
    </View>
  );
}
