import { useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import { useTagFilter } from '@/hooks/useTagFilter';
import { useNotifications } from '@/hooks/useNotifications';
import { supabase } from '@/lib/supabase';
import { Avatar } from '@/components/ui/Avatar';
import { PressableScale } from '@/components/ui/PressableScale';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { NotificationBadge } from '@/components/ui/NotificationBadge';
import { ActivitySummary } from '@/components/mypage/ActivitySummary';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';
import { MypageSkeleton } from '@/components/ui/Skeleton';
import { Icon } from '@/constants/icons';
import { C, GRAD, R, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import { TABBAR } from '@/design/tabbar';

export default function MypageScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, signOut } = useAuthStore();
  const { likedTags } = useTagFilter();
  const { unreadCount } = useNotifications();
  const showActivity = useFeatureFlag('profile_summary');
  const [logoutOpen, setLogoutOpen] = useState(false);

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['mypage-stats', user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase
        .from('profiles')
        .select('post_count, like_received_count, trust_score, nickname, avatar_emoji, avatar_url')
        .eq('id', user.id)
        .single();
      return data as {
        post_count: number;
        like_received_count: number;
        trust_score: number;
        nickname: string | null;
        avatar_emoji: string | null;
        avatar_url: string | null;
      } | null;
    },
    enabled: !!user,
  });

  const accountAge = user?.created_at
    ? Math.floor((Date.now() - new Date(user.created_at).getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  const trustScore = stats?.trust_score ?? 50;

  if (statsLoading && !stats) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
        <MypageSkeleton />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top,
          paddingBottom: TABBAR.height + insets.bottom + SP['10'],
        }}
      >
        {/* ヘッダー: グラデーション背景 + アクションボタン */}
        <LinearGradient
          colors={[C.accentBg, C.bg]}
          style={{ paddingTop: SP['4'], paddingBottom: SP['6'], paddingHorizontal: SP['4'] }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: SP['2'], marginBottom: SP['4'] }}>
            <PressableScale
              onPress={() => router.push('/notifications' as never)}
              haptic="tap"
              style={{
                width: 38, height: 38, borderRadius: 19,
                backgroundColor: C.bg2,
                alignItems: 'center', justifyContent: 'center',
                borderWidth: 1, borderColor: C.border,
              }}
            >
              <Icon.bell size={18} color={C.text} strokeWidth={2.2} />
              <NotificationBadge count={unreadCount} top={2} right={2} />
            </PressableScale>
            <PressableScale
              onPress={() => router.push('/settings' as never)}
              haptic="tap"
              style={{
                width: 38, height: 38, borderRadius: 19,
                backgroundColor: C.bg2,
                alignItems: 'center', justifyContent: 'center',
                borderWidth: 1, borderColor: C.border,
              }}
            >
              <Icon.settings size={18} color={C.text} strokeWidth={2.2} />
            </PressableScale>
          </View>

          {/* プロフィール中央 */}
          <View style={{ alignItems: 'center', gap: SP['3'] }}>
            <LinearGradient
              colors={[...GRAD.accent]}
              style={{ padding: 2, borderRadius: 54 }}
            >
              <View style={{ borderRadius: 52, overflow: 'hidden', backgroundColor: C.bg }}>
                <Avatar size={100} name={user?.nickname ?? user?.email} emoji={stats?.avatar_emoji ?? undefined} uri={stats?.avatar_url ?? undefined} />
              </View>
            </LinearGradient>
            <View style={{ alignItems: 'center', gap: 4 }}>
              <Text style={[T.h2, { color: C.text }]}>
                {user?.nickname ?? 'ユーザー'}
              </Text>
              <Text style={[T.caption, { color: C.text3, letterSpacing: 0.5 }]}>
                匿名 · {accountAge}日目
              </Text>
            </View>
            <PressableScale
              onPress={() => router.push('/settings/profile-edit' as never)}
              haptic="tap"
              style={{
                paddingHorizontal: SP['4'],
                paddingVertical: 6,
              }}
            >
              <Text style={[T.smallM, { color: C.accent, fontWeight: '600' }]}>編集</Text>
            </PressableScale>
          </View>
        </LinearGradient>

        {/* 統計 (フラット 3 列) */}
        <View style={{
          flexDirection: 'row',
          marginHorizontal: SP['4'],
          marginTop: -SP['2'],
          paddingVertical: SP['3'],
        }}>
          <StatItem value={stats?.post_count ?? 0} label="投稿" />
          <StatItem value={stats?.like_received_count ?? 0} label="いいね" />
          <StatItem value={trustScore} label="信頼" color={trustScore >= 70 ? C.green : trustScore >= 40 ? C.amber : C.red} />
        </View>

        {/* 今週の活動サマリー */}
        {showActivity && <ActivitySummary />}


        {/* 好きタグ */}
        {likedTags.length > 0 && (
          <View style={{ paddingHorizontal: SP['4'], marginTop: SP['4'], gap: SP['2'] }}>
            <Text style={[T.caption, { color: C.text3, letterSpacing: 0.5 }]}>タグ</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {likedTags.slice(0, 10).map((t) => (
                <PressableScale
                  key={t}
                  onPress={() => router.push(`/tag/${encodeURIComponent(t)}` as never)}
                  haptic="tap"
                  style={{
                    paddingHorizontal: SP['3'],
                    paddingVertical: 6,
                    backgroundColor: C.bg2,
                    borderRadius: R.full,
                  }}
                >
                  <Text style={[T.smallM, { color: C.text }]}>#{t}</Text>
                </PressableScale>
              ))}
              {likedTags.length > 10 && (
                <PressableScale
                  onPress={() => router.push('/filter' as never)}
                  style={{
                    paddingHorizontal: SP['3'],
                    paddingVertical: 6,
                    borderRadius: R.full,
                  }}
                >
                  <Text style={[T.smallM, { color: C.text3 }]}>+{likedTags.length - 10}</Text>
                </PressableScale>
              )}
            </View>
          </View>
        )}

        {/* メニューグリッド */}
        <View style={{
          paddingHorizontal: SP['4'],
          marginTop: SP['5'],
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: SP['3'],
        }}>
          <MenuTile
            icon={Icon.edit}
            label="自分の投稿"
            onPress={() => router.push('/mypage/posts' as never)}
            color={C.accent}
          />
          <MenuTile
            icon={Icon.heart}
            label="いいね"
            onPress={() => router.push('/mypage/liked' as never)}
            color={C.pink}
          />
          <MenuTile
            icon={Icon.save}
            label="保存"
            onPress={() => router.push('/mypage/saved' as never)}
            color={C.amber}
          />
          <MenuTile
            icon={Icon.community}
            label="コミュニティ"
            onPress={() => router.push('/(tabs)/community' as never)}
            color={C.pink}
          />
          <MenuTile
            icon={Icon.calendar}
            label="カレンダー"
            onPress={() => router.push('/corners/calendar' as never)}
            color={C.amber}
          />
          <MenuTile
            icon={Icon.shield}
            label="信頼スコア"
            onPress={() => router.push('/settings/trust-score' as never)}
            color={C.accent}
          />
          <MenuTile
            icon={Icon.award}
            label="プラン"
            onPress={() => router.push('/settings/plan' as never)}
            color={C.green}
          />
          <MenuTile
            icon={Icon.hash}
            label="ブロックタグ"
            onPress={() => router.push('/settings/blocked-tags' as never)}
            color="#E24B4A"
          />
          <MenuTile
            icon={Icon.block}
            label="ブロック中"
            onPress={() => router.push('/settings/blocked-users' as never)}
            color={C.block}
          />
        </View>

        {/* ログアウト */}
        <View style={{ paddingHorizontal: SP['4'], marginTop: SP['6'] }}>
          <PressableScale
            onPress={() => setLogoutOpen(true)}
            haptic="warn"
            style={{
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: SP['3'],
            }}
          >
            <Text style={[T.smallM, { color: C.red, letterSpacing: 0.5 }]}>ログアウト</Text>
          </PressableScale>
        </View>
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

function StatItem({ value, label, color }: { value: number; label: string; color?: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 4 }}>
      <Text style={{ fontSize: 24, fontWeight: '700', color: color ?? C.text, letterSpacing: -0.5 }}>
        {value.toLocaleString()}
      </Text>
      <Text style={[T.caption, { color: C.text3, letterSpacing: 0.5 }]}>{label}</Text>
    </View>
  );
}

type IconComponent = React.ComponentType<Record<string, unknown>>;

function MenuTile({
  icon: I,
  label,
  onPress,
  color,
}: {
  icon: IconComponent;
  label: string;
  onPress: () => void;
  color: string;
}) {
  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      style={{
        flexBasis: '30%',
        flexGrow: 1,
        paddingVertical: SP['4'],
        paddingHorizontal: SP['2'],
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        alignItems: 'center',
        gap: SP['2'],
      }}
    >
      <I size={22} color={color} strokeWidth={2} />
      <Text style={[T.smallM, { color: C.text }]}>{label}</Text>
    </PressableScale>
  );
}
