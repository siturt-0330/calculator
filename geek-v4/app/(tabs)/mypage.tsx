import { useState } from 'react';
import { View, Text, ScrollView, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react-native';
import { useAuthStore } from '../../stores/authStore';
import { useNotifications } from '../../hooks/useNotifications';
import { supabase } from '../../lib/supabase';
import { fetchMyCommunities, type Community } from '../../lib/api/communities';
import { fetchMyOfficialCommunities } from '../../lib/api/officialCommunities';
import { sanitizeUrl } from '../../lib/sanitize';
import { computeTrustBreakdown } from '../../lib/trust/score';
import { Avatar } from '../../components/ui/Avatar';
import { PressableScale } from '../../components/ui/PressableScale';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { NotificationBadge } from '../../components/ui/NotificationBadge';
import { MypageSkeleton } from '../../components/ui/Skeleton';
import { Icon } from '../../constants/icons';
import { C, R, SP, SHADOW } from '../../design/tokens';
import { T } from '../../design/typography';
import { TABBAR } from '../../design/tabbar';
import { OBSIDIAN_AVAILABLE } from '../../lib/obsidian';

type MypageStats = {
  post_count: number;
  like_received_count: number;
  comment_count: number;
  concern_received_count: number;
  created_at: string | null;
  nickname: string | null;
  avatar_emoji: string | null;
  avatar_url: string | null;
};

export default function MypageScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // selector: 全 destructure → 必要フィールドのみ subscribe (account_state 等の他フィールド更新で
  // re-render するのを防ぐ)
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const { unreadCount } = useNotifications();
  const [logoutOpen, setLogoutOpen] = useState(false);

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['mypage-stats', user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase
        .from('profiles')
        .select('post_count, like_received_count, comment_count, concern_received_count, created_at, nickname, avatar_emoji, avatar_url')
        .eq('id', user.id)
        .single();
      return data as MypageStats | null;
    },
    enabled: !!user,
    // 自分の集計値はほぼ stale OK — 1 分は再 fetch しない
    staleTime: 60_000,
  });

  const { data: myCommunities = [] } = useQuery<Community[]>({
    queryKey: ['mypage-my-communities', user?.id],
    queryFn: fetchMyCommunities,
    enabled: !!user,
    staleTime: 60_000,
  });
  const communityCount = myCommunities.length;

  // 公式コミュニティを管理しているかどうか — Geek Official 行を出すか判定
  const { data: officialCommunities = [] } = useQuery<Community[]>({
    queryKey: ['my-official-communities', user?.id],
    queryFn: fetchMyOfficialCommunities,
    enabled: !!user,
    staleTime: 60_000,
  });
  const hasOfficial = officialCommunities.length > 0;

  // 運営からの未読メッセージ件数。 head:true + count:'exact' で行データを転送せず
  // 件数だけ取得 — mypage Row の数字バッジ表示用。
  // 同じ queryKey を messages.tsx 側の optimistic update でも触っているので、
  // 既読化したらバッジは即座に減る。
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

  const accountAge = user?.created_at
    ? Math.floor((Date.now() - new Date(user.created_at).getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  // 信用スコア: tier + 現在値を mypage の Row に表示
  const trust = computeTrustBreakdown({
    post_count: stats?.post_count ?? 0,
    like_received_count: stats?.like_received_count ?? 0,
    comment_count: stats?.comment_count ?? 0,
    concern_received_count: stats?.concern_received_count ?? 0,
    created_at: stats?.created_at ?? user?.created_at ?? null,
  });

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
          paddingBottom: TABBAR.height + insets.bottom + SP['10'],
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* ───────── 上部: アイコン2つだけのミニマルバー ───────── */}
        <View
          style={{
            paddingTop: insets.top + SP['2'],
            paddingHorizontal: SP['4'],
            paddingBottom: SP['1'],
            flexDirection: 'row',
            justifyContent: 'flex-end',
            gap: SP['1'],
          }}
        >
          <IconButton
            icon={Icon.bell}
            badge={unreadCount}
            onPress={() => router.push('/notifications' as never)}
          />
          <IconButton
            icon={Icon.settings}
            onPress={() => router.push('/settings' as never)}
          />
        </View>

        {/* ───────── ヒーロー: 大きなアバター + 名前 ───────── */}
        <View style={{ alignItems: 'center', paddingTop: SP['4'], paddingHorizontal: SP['4'], gap: SP['3'] }}>
          <Avatar
            size={96}
            name={user?.nickname ?? user?.email}
            emoji={stats?.avatar_emoji ?? undefined}
            uri={stats?.avatar_url ?? undefined}
          />
          <View style={{ alignItems: 'center', gap: 2 }}>
            <Text style={[T.h1, { color: C.text, textAlign: 'center' }]} numberOfLines={1}>
              {stats?.nickname ?? user?.nickname ?? 'ユーザー'}
            </Text>
            <Text style={[T.small, { color: C.text3, letterSpacing: 0.5 }]}>
              匿名 · {accountAge}日目
            </Text>
          </View>
          <PressableScale
            onPress={() => router.push('/settings/profile-edit' as never)}
            haptic="tap"
            style={{
              marginTop: SP['1'],
              paddingHorizontal: SP['4'],
              paddingVertical: SP['2'],
              borderRadius: R.full,
              borderWidth: 1,
              borderColor: C.border2,
              // 控えめなインタラクションだが micro-interaction で「押せる」感を強化
              backgroundColor: C.bg2,
            }}
          >
            <Text style={[T.smallM, { color: C.text2, letterSpacing: 0.3 }]}>プロフィールを編集</Text>
          </PressableScale>
        </View>

        {/* ───────── KPI: 3 つの大きな数字カード ───────── */}
        <View
          style={{
            flexDirection: 'row',
            marginTop: SP['6'],
            marginHorizontal: SP['4'],
            gap: SP['2'],
          }}
        >
          <Kpi value={stats?.post_count ?? 0} label="投稿" />
          <Kpi value={stats?.like_received_count ?? 0} label="もらった♥" />
          <Kpi value={communityCount} label="コミュ" />
        </View>

        {/* ───────── プライマリアクション 2 つ ───────── */}
        <View
          style={{
            flexDirection: 'row',
            marginTop: SP['4'],
            marginHorizontal: SP['4'],
            gap: SP['2'],
          }}
        >
          <PrimaryAction
            icon={Icon.post}
            label="投稿する"
            onPress={() => router.push('/post/create' as never)}
            solid
          />
          <PrimaryAction
            icon={Icon.calendar}
            label="カレンダー"
            onPress={() => router.push('/corners/calendar' as never)}
          />
        </View>

        {/* ───────── セクション: マイコミュニティ ───────── */}
        <MyCommunitiesSection communities={myCommunities} />

        {/* ───────── セクション: アクティビティ ───────── */}
        <Section title="アクティビティ">
          <Row
            icon={Icon.edit}
            label="自分の投稿"
            onPress={() => router.push('/mypage/posts' as never)}
          />
          <RowDivider />
          <Row
            icon={Icon.heart}
            label="いいねした投稿"
            onPress={() => router.push('/mypage/liked' as never)}
          />
          <RowDivider />
          <Row
            icon={Icon.save}
            label="保存した投稿"
            onPress={() => router.push('/mypage/saved' as never)}
          />
          <RowDivider />
          {/* 運営からの DM 受信箱 — 未読があれば数字 pill */}
          <Row
            icon={Icon.send}
            label="運営からのメッセージ"
            right={unreadAdminMessages > 0 ? <Pill text={String(unreadAdminMessages)} /> : undefined}
            onPress={() => router.push('/mypage/messages' as never)}
          />
          {hasOfficial && (
            <>
              <RowDivider />
              <Row
                icon={Icon.shield}
                label="Geek Official"
                right={<AccentPill text={`${officialCommunities.length}`} />}
                onPress={() => router.push('/official' as never)}
              />
            </>
          )}
        </Section>

        {/* ───────── セクション: アカウント ───────── */}
        <Section title="アカウント">
          <Row
            icon={Icon.shield}
            label="信用スコア"
            right={<TierBadge emoji={trust.tier.emoji} score={trust.score} color={trust.tier.color} />}
            onPress={() => router.push('/settings/trust-score' as never)}
          />
          <RowDivider />
          <Row
            icon={Icon.award}
            label="プラン"
            onPress={() => router.push('/settings/plan' as never)}
          />
          <RowDivider />
          <Row
            icon={Icon.bell}
            label="通知"
            right={unreadCount > 0 ? <Pill text={String(unreadCount)} /> : undefined}
            onPress={() => router.push('/notifications' as never)}
          />
        </Section>

        {/* ───────── セクション: プライバシー ───────── */}
        <Section title="プライバシー">
          <Row
            icon={Icon.hash}
            label="ブロックしたタグ"
            onPress={() => router.push('/settings/blocked-tags' as never)}
          />
          <RowDivider />
          <Row
            icon={Icon.block}
            label="ブロックしたユーザー"
            onPress={() => router.push('/settings/blocked-users' as never)}
          />
          <RowDivider />
          <Row
            icon={Icon.settings}
            label="すべての設定"
            onPress={() => router.push('/settings' as never)}
          />
        </Section>

        {OBSIDIAN_AVAILABLE && (
          <Section title="開発">
            <Row
              icon={Icon.edit}
              label="Obsidian (DEV)"
              onPress={() => router.push('/settings/obsidian' as never)}
            />
          </Section>
        )}

        {/* ───────── ログアウト (控えめ) ───────── */}
        <PressableScale
          onPress={() => setLogoutOpen(true)}
          haptic="warn"
          style={{
            marginTop: SP['8'],
            marginHorizontal: SP['4'],
            paddingVertical: SP['3'],
            alignItems: 'center',
          }}
        >
          <Text style={[T.smallM, { color: C.red, letterSpacing: 0.5 }]}>ログアウト</Text>
        </PressableScale>
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

// ───────────────────────────────────────────────────────────────
// 内部コンポーネント
// ───────────────────────────────────────────────────────────────

function IconButton({
  icon: I,
  onPress,
  badge,
}: {
  icon: LucideIcon;
  onPress: () => void;
  badge?: number;
}) {
  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      style={{
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <I size={22} color={C.text} strokeWidth={2.2} />
      {badge !== undefined && <NotificationBadge count={badge} top={4} right={4} />}
    </PressableScale>
  );
}

function Kpi({ value, label }: { value: number; label: string }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
        paddingVertical: SP['4'],
        paddingHorizontal: SP['2'],
        alignItems: 'center',
        gap: 2,
      }}
    >
      <Text
        style={{
          fontSize: 26,
          fontWeight: '800',
          color: C.text,
          letterSpacing: -0.5,
          lineHeight: 30,
        }}
      >
        {value.toLocaleString('ja-JP')}
      </Text>
      <Text style={[T.caption, { color: C.text3, letterSpacing: 0.5 }]}>{label}</Text>
    </View>
  );
}

function PrimaryAction({
  icon: I,
  label,
  onPress,
  solid,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  solid?: boolean;
}) {
  const bg = solid ? C.accent : C.bg2;
  const border = solid ? C.accent : C.border;
  const textColor = solid ? '#fff' : C.text;
  const iconColor = solid ? '#fff' : C.text2;
  return (
    <PressableScale
      onPress={onPress}
      haptic={solid ? 'confirm' : 'tap'}
      style={{
        flex: 1,
        backgroundColor: bg,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: border,
        paddingVertical: SP['3'],
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        // solid (= primary) のみ accent halo を付与
        ...(solid ? SHADOW.accentGlow : {}),
      }}
    >
      <I size={16} color={iconColor} strokeWidth={2.4} />
      <Text style={[T.smallB, { color: textColor }]}>{label}</Text>
    </PressableScale>
  );
}

// ───────────────────────────────────────────────────────────────
// マイコミュニティ: 横スクロール — タップで /community/{id}
// ───────────────────────────────────────────────────────────────
function MyCommunitiesSection({ communities }: { communities: Community[] }) {
  const router = useRouter();
  const empty = communities.length === 0;

  return (
    <View style={{ marginTop: SP['6'] }}>
      <Text
        style={[
          T.smallB,
          {
            color: C.text3,
            paddingHorizontal: SP['4'],
            paddingBottom: SP['2'],
            letterSpacing: 1.2,
            fontSize: 11,
          },
        ]}
      >
        {'マイコミュニティ'.toUpperCase()}
      </Text>
      {empty ? (
        <View
          style={{
            marginHorizontal: SP['4'],
            backgroundColor: C.bg2,
            borderRadius: R.lg,
            borderWidth: 1,
            borderColor: C.border,
            paddingVertical: SP['5'],
            paddingHorizontal: SP['4'],
            alignItems: 'center',
            gap: SP['2'],
          }}
        >
          <Text style={[T.body, { color: C.text2, textAlign: 'center' }]}>
            まだ参加していません 🎯
          </Text>
          <PressableScale
            onPress={() => router.push('/community/discover' as never)}
            haptic="confirm"
            style={{
              paddingHorizontal: SP['4'],
              paddingVertical: SP['2'],
              borderRadius: R.full,
              backgroundColor: C.accent,
            }}
          >
            <Text style={[T.smallM, { color: '#fff', fontWeight: '700' }]}>
              コミュニティを探す
            </Text>
          </PressableScale>
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: SP['4'], gap: SP['3'] }}
        >
          {communities.map((c) => (
            <CommunityChip key={c.id} community={c} onPress={() => router.push(`/community/${c.id}` as never)} />
          ))}
          <PressableScale
            onPress={() => router.push('/community/discover' as never)}
            haptic="tap"
            style={{ alignItems: 'center', gap: 6, width: 64 }}
          >
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 28,
                backgroundColor: C.bg2,
                borderWidth: 1,
                borderColor: C.border,
                borderStyle: 'dashed',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon.plus size={22} color={C.text2} strokeWidth={2.2} />
            </View>
            <Text style={[T.caption, { color: C.text3, fontSize: 10 }]} numberOfLines={1}>
              探す
            </Text>
          </PressableScale>
        </ScrollView>
      )}
    </View>
  );
}

function CommunityChip({ community, onPress }: { community: Community; onPress: () => void }) {
  const safeIconUrl = community.icon_url ? sanitizeUrl(community.icon_url) : null;
  return (
    <PressableScale onPress={onPress} haptic="tap" style={{ alignItems: 'center', gap: 6, width: 64 }}>
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: safeIconUrl ? C.bg3 : community.icon_color,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: C.border,
        }}
      >
        {safeIconUrl ? (
          <Image source={{ uri: safeIconUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        ) : (
          <Text style={{ fontSize: 28 }}>{community.icon_emoji}</Text>
        )}
      </View>
      <Text style={[T.caption, { color: C.text2, fontSize: 10 }]} numberOfLines={1}>
        {community.name}
      </Text>
    </PressableScale>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: SP['6'] }}>
      <Text
        style={[
          T.smallB,
          {
            color: C.text3,
            paddingHorizontal: SP['4'],
            paddingBottom: SP['2'],
            letterSpacing: 1.2,
            fontSize: 11,
          },
        ]}
      >
        {title.toUpperCase()}
      </Text>
      <View
        style={{
          marginHorizontal: SP['4'],
          backgroundColor: C.bg2,
          borderRadius: R.lg,
          borderWidth: 1,
          borderColor: C.border,
          overflow: 'hidden',
        }}
      >
        {children}
      </View>
    </View>
  );
}

function Row({
  icon: I,
  label,
  right,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  right?: React.ReactNode;
  onPress: () => void;
}) {
  const ChevronR = Icon.chevronR;
  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      scaleValue={0.99}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: SP['4'],
        paddingVertical: SP['3'],
        gap: SP['3'],
      }}
    >
      <I size={19} color={C.text2} strokeWidth={2} />
      <Text style={[T.body, { flex: 1, color: C.text }]}>{label}</Text>
      {right}
      <ChevronR size={16} color={C.text4} strokeWidth={2.2} />
    </PressableScale>
  );
}

function RowDivider() {
  return <View style={{ height: 1, backgroundColor: C.divider, marginLeft: SP['4'] + 19 + SP['3'] }} />;
}

function Pill({ text }: { text: string }) {
  return (
    <View
      style={{
        minWidth: 22,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: R.full,
        backgroundColor: C.red,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{text}</Text>
    </View>
  );
}

function AccentPill({ text }: { text: string }) {
  return (
    <View
      style={{
        minWidth: 22,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: R.full,
        backgroundColor: C.accentBg,
        borderWidth: 1,
        borderColor: C.accent + '66',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: C.accentLight, fontSize: 11, fontWeight: '800', letterSpacing: 0.3 }}>{text}</Text>
    </View>
  );
}

function TierBadge({ emoji, score, color }: { emoji: string; score: number; color: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: R.full,
        backgroundColor: C.bg3,
        borderWidth: 1,
        borderColor: color + '55',
      }}
    >
      <Text style={{ fontSize: 12 }}>{emoji}</Text>
      <Text style={{ color, fontSize: 11, fontWeight: '700', letterSpacing: 0.3 }}>{score}</Text>
    </View>
  );
}
