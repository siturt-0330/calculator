import { View, Text, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/authStore';
import { useTagFilter } from '@/hooks/useTagFilter';
import { TopBar } from '@/components/nav/TopBar';
import { Avatar } from '@/components/ui/Avatar';
import { TrustBar } from '@/components/ui/TrustBar';
import { TagPill } from '@/components/tag/TagPill';
import { PressableScale } from '@/components/ui/PressableScale';
import { Divider } from '@/components/ui/Divider';
import { ListItem } from '@/components/ui/ListItem';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Icon } from '@/constants/icons';
import { C, R, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import { TABBAR } from '@/design/tabbar';

export default function MypageScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, signOut } = useAuthStore();
  const { likedTags, blockedTags } = useTagFilter();
  const Settings = Icon.settings;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar
        title="マイページ"
        right={
          <PressableScale
            onPress={() => router.push('/settings' as never)}
            style={{ padding: SP['2'] }}
          >
            <Settings size={22} color={C.text} strokeWidth={2.2} />
          </PressableScale>
        }
      />

      <ScrollView
        contentContainerStyle={{
          paddingBottom: TABBAR.height + insets.bottom + SP['10'],
        }}
      >
        {/* プロフィール */}
        <View
          style={{
            padding: SP['6'],
            alignItems: 'center',
            gap: SP['3'],
          }}
        >
          <Avatar size={80} name={user?.email} />
          <View style={{ alignItems: 'center', gap: SP['1'] }}>
            <Text style={[T.h3, { color: C.text }]}>
              {user?.email?.split('@')[0] ?? 'ユーザー'}
            </Text>
            <Text style={[T.small, { color: C.text3 }]}>{user?.email}</Text>
          </View>
          <PressableScale
            onPress={() => router.push('/settings/profile-edit' as never)}
            style={{
              paddingHorizontal: SP['5'],
              paddingVertical: SP['2'],
              borderRadius: R.full,
              borderWidth: 1,
              borderColor: C.border,
            }}
          >
            <Text style={[T.smallM, { color: C.text2 }]}>プロフィールを編集</Text>
          </PressableScale>
        </View>

        {/* 信頼スコア */}
        <View style={{ paddingHorizontal: SP['4'], marginBottom: SP['4'] }}>
          <TrustBar score={50} />
        </View>

        <Divider />

        {/* 好きタグ */}
        {likedTags.length > 0 && (
          <>
            <SectionHeader title="好きなタグ" />
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                paddingHorizontal: SP['4'],
                paddingBottom: SP['3'],
                gap: SP['2'],
              }}
            >
              {likedTags.map((t) => (
                <TagPill
                  key={t}
                  name={t}
                  state="liked"
                  onPress={() => router.push(`/tag/${encodeURIComponent(t)}` as never)}
                />
              ))}
            </View>
            <Divider />
          </>
        )}

        {/* ブロックタグ */}
        {blockedTags.length > 0 && (
          <>
            <SectionHeader title="ブロック中のタグ" />
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                paddingHorizontal: SP['4'],
                paddingBottom: SP['3'],
                gap: SP['2'],
              }}
            >
              {blockedTags.map((t) => (
                <TagPill key={t} name={t} state="blocked" />
              ))}
            </View>
            <Divider />
          </>
        )}

        {/* 設定リスト */}
        <SectionHeader title="設定" />
        <ListItem
          icon={Icon.settings}
          label="アカウント設定"
          onPress={() => router.push('/settings' as never)}
          sublabel="プロフィール・通知・プライバシー"
        />
        <Divider />
        <ListItem
          icon={Icon.shield}
          label="信頼スコア"
          onPress={() => router.push('/settings/trust-score' as never)}
          sublabel="スコアの詳細を確認"
        />
        <Divider />
        <ListItem
          icon={Icon.logout}
          label="ログアウト"
          onPress={signOut}
          destructive
        />
      </ScrollView>
    </View>
  );
}
