// =============================================================================
// LeftSidebar — デスクトップ Web の常時表示 X 風サイドバー
// -----------------------------------------------------------------------------
// (tabs)/_layout.tsx で width >= 1100px のときだけ Tabs の左に置く固定カラム。
// モバイルでは HomeDrawer がこれと同等の役割を担うので、本コンポーネントは
// 描画されない (親で gating)。
//
// 構成:
//   - Geek ロゴ (グラデ wordmark / feed.tsx と同等の見栄え)
//   - ナビ群 (ホーム / コミュニティ / 検索 / 通知 / 保存済み / マイプロフィール / 設定)
//   - 投稿するボタン (accent 塗りの大きめ pill)
//   - 最下部のアカウントブロック (アバター + 名前 + handle / タップで /mypage)
//
// 各ナビは router.push でタブ/画面に遷移。タブ切替は path-based なので、
// expo-router が active tab を自動でマウントしなおす。
// =============================================================================

import { View, Text, Platform, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  PenLine,
  Home,
  Users2,
  Search as SearchIcon,
  Bell,
  Bookmark,
  User as UserIcon,
  Settings as SettingsIcon,
  type LucideIcon,
} from 'lucide-react-native';

import { Avatar } from '../ui/Avatar';
import { PressableScale } from '../ui/PressableScale';
import { useAuthStore } from '../../stores/authStore';
import { supabase } from '../../lib/supabase';
import { useNotifications } from '../../hooks/useNotifications';
import { useTheme } from '../../hooks/useColors';
import { R, SP } from '../../design/tokens';
import { T, LOGO_FONT, LOGO_FONT_WEIGHT } from '../../design/typography';
import { NotificationBadge } from '../ui/NotificationBadge';

type MeProfileLite = {
  nickname: string | null;
  avatar_emoji: string | null;
  avatar_url: string | null;
};

export function LeftSidebar() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { C } = useTheme();

  const userId = useAuthStore((s) => s.user?.id);
  const fallbackNickname = useAuthStore((s) => s.user?.nickname);
  const { unreadCount } = useNotifications();

  // feed.tsx / HomeDrawer と同じ queryKey / fn で cache 共有
  const { data: stats } = useQuery<MeProfileLite | null>({
    queryKey: ['mypage-stats', userId],
    queryFn: async () => {
      if (!userId) return null;
      const { data } = await supabase
        .from('profiles')
        .select('post_count, like_received_count, comment_count, concern_received_count, created_at, nickname, avatar_emoji, avatar_url')
        .eq('id', userId)
        .single();
      return data as MeProfileLite | null;
    },
    enabled: !!userId,
    staleTime: 60_000,
  });

  const nickname = stats?.nickname ?? fallbackNickname ?? 'ユーザー';
  const handle = `@${nickname}`;

  return (
    <View
      style={{
        width: 260,
        height: '100%',
        backgroundColor: C.bg,
        borderRightWidth: 1,
        borderRightColor: C.divider,
        paddingTop: insets.top + SP['3'],
        paddingBottom: insets.bottom + SP['3'],
        paddingHorizontal: SP['3'],
      }}
    >
      {/* ===== Geek ロゴ (feed.tsx と同じ意匠 / グラデ wordmark) ===== */}
      <View style={{ paddingHorizontal: SP['3'], paddingBottom: SP['4'] }}>
        <Text
          allowFontScaling={false}
          style={[
            {
              fontFamily: LOGO_FONT,
              fontWeight: LOGO_FONT_WEIGHT,
              fontSize: 28,
              lineHeight: 32,
              letterSpacing: -0.7,
              color: C.text,
            },
            Platform.OS === 'web'
              ? ({
                  backgroundImage:
                    'linear-gradient(110deg, #b794f4 0%, #7c6af7 35%, #67c1ff 75%, #6ee7b7 100%)',
                  backgroundClip: 'text',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  color: 'transparent',
                  textShadow:
                    '0 0 14px rgba(124,106,247,0.55), 0 0 28px rgba(103,193,255,0.25)',
                  transform: 'skewX(-4deg)',
                } as object)
              : {
                  color: C.accent,
                  textShadowColor: C.accent + '88',
                  textShadowOffset: { width: 0, height: 0 },
                  textShadowRadius: 10,
                  transform: [{ skewX: '-4deg' }],
                },
          ]}
        >
          Geek
        </Text>
      </View>

      {/* ===== ナビ群 ===== */}
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        <NavItem icon={Home} label="ホーム" onPress={() => router.push('/(tabs)/feed' as never)} C={C} />
        <NavItem icon={Users2} label="コミュニティ" onPress={() => router.push('/(tabs)/community' as never)} C={C} />
        <NavItem icon={SearchIcon} label="検索" onPress={() => router.push('/(tabs)/search' as never)} C={C} />
        <NavItem
          icon={Bell}
          label="通知"
          badge={unreadCount}
          onPress={() => router.push('/notifications' as never)}
          C={C}
        />
        <NavItem icon={Bookmark} label="保存済み" onPress={() => router.push('/mypage/saved' as never)} C={C} />
        <NavItem icon={UserIcon} label="マイプロフィール" onPress={() => router.push('/(tabs)/mypage' as never)} C={C} />
        <NavItem icon={SettingsIcon} label="設定" onPress={() => router.push('/settings' as never)} C={C} />

        {/* ===== 投稿する (primary CTA) ===== */}
        <PressableScale
          onPress={() => router.push('/post/create' as never)}
          haptic="tap"
          accessibilityRole="button"
          accessibilityLabel="投稿をする"
          style={{
            marginTop: SP['3'],
            marginHorizontal: SP['2'],
            paddingVertical: SP['3'],
            paddingHorizontal: SP['4'],
            borderRadius: R.full,
            backgroundColor: C.accent,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: SP['2'],
          }}
        >
          <PenLine size={18} color="#fff" strokeWidth={2.2} />
          <Text style={[T.smallB, { color: '#fff', fontSize: 15 }]}>投稿をする</Text>
        </PressableScale>
      </ScrollView>

      {/* ===== 最下部のアカウントブロック (タップで /mypage) ===== */}
      <PressableScale
        onPress={() => router.push('/(tabs)/mypage' as never)}
        haptic="tap"
        accessibilityRole="button"
        accessibilityLabel="マイページを開く"
        style={{
          marginTop: SP['3'],
          marginHorizontal: SP['1'],
          padding: SP['3'],
          borderRadius: R.full,
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['3'],
          backgroundColor: C.glass,
          borderWidth: 1,
          borderColor: C.glassBorder,
        }}
      >
        <Avatar
          size={40}
          uri={stats?.avatar_url ?? undefined}
          emoji={stats?.avatar_emoji ?? undefined}
          name={nickname}
        />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[T.smallB, { color: C.text, fontSize: 14 }]} numberOfLines={1}>
            {nickname}
          </Text>
          <Text style={[T.caption, { color: C.text3 }]} numberOfLines={1}>
            {handle}
          </Text>
        </View>
      </PressableScale>
    </View>
  );
}

// ---- NavItem (小さなナビ行) ----
function NavItem({
  icon: Icon,
  label,
  badge,
  onPress,
  C,
}: {
  icon: LucideIcon;
  label: string;
  badge?: number;
  onPress: () => void;
  C: ReturnType<typeof useTheme>['C'];
}) {
  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      accessibilityRole="menuitem"
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['3'],
        paddingVertical: SP['3'],
        paddingHorizontal: SP['3'],
        borderRadius: R.full,
      }}
    >
      <View>
        <Icon size={22} color={C.text} strokeWidth={1.9} />
        {badge && badge > 0 ? <NotificationBadge count={badge} top={-6} right={-8} /> : null}
      </View>
      <Text style={[T.body, { color: C.text, fontSize: 16, flex: 1 }]} numberOfLines={1}>
        {label}
      </Text>
    </PressableScale>
  );
}
