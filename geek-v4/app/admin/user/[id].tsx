import { useMemo, useState } from 'react';
import { View, Text, ScrollView, TextInput, ActivityIndicator, Platform } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  Layout,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { TopBar } from '../../../components/nav/TopBar';
import { BackButton } from '../../../components/nav/BackButton';
import { PressableScale } from '../../../components/ui/PressableScale';
import { MiniMetric } from '../../../components/admin/MiniMetric';
import { Spinner } from '../../../components/ui/Spinner';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { Avatar } from '../../../components/ui/Avatar';
import { Icon } from '../../../constants/icons';
import { useToastStore } from '../../../stores/toastStore';
import { C, R, SP, SHADOW } from '../../../design/tokens';
import { T } from '../../../design/typography';
import { formatRelative } from '../../../lib/utils/date';
import {
  fetchUserDetail,
  suspendUser,
  unsuspendUser,
  deleteAllUserPosts,
  resetAccountState,
  deletePost,
  type AdminUser,
  type AdminPost,
  type ConcernSummary,
  type ModerationLog,
} from '../../../lib/api/admin';
import { supabase } from '../../../lib/supabase';

// ============================================================
// /admin/user/[id] — premium CRM dashboard for a single user.
// 隠し /admin 配下なので _layout.tsx の email-gate を通る前提。
// 操作系は全て ConfirmDialog gated + toast。
// ============================================================

type Tab = 'posts' | 'concerns' | 'moderation';
type DateFilter = 'all' | 'month' | 'week' | 'today';

// account_state → 色 / 表示ラベル / ring の見た目。
// healthy だけ「正常」に置き換え。"restricted" は橙、"warned" は赤、
// "suspended" は最も濃い暗赤で stop sign 感を出す。
const STATE_META: Record<
  string,
  { label: string; color: string; bg: string; ring: string }
> = {
  healthy:    { label: '正常',   color: C.green,  bg: C.greenBg, ring: C.green },
  caution:    { label: '注意',   color: C.amber,  bg: C.amberBg, ring: C.amber },
  restricted: { label: '制限中', color: '#FF8A3D', bg: C.amberBg, ring: '#FF8A3D' },
  warned:     { label: '警告中', color: C.red,    bg: C.redBg,   ring: C.red },
  suspended:  { label: '凍結中', color: '#FF4D4D', bg: '#1a0606', ring: '#7a1a1a' },
};

// 日齢 = 登録から今日までの日数。
function daysSince(iso: string): number {
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return 0;
  return Math.max(0, Math.floor((Date.now() - d) / 86_400_000));
}

// moderation_log の action 列 → 表示用 emoji + 日本語ラベル。
function actionMeta(action: string): { emoji: string; label: string; color: string } {
  switch (action) {
    case 'suspend':      return { emoji: '🚫', label: '凍結',     color: C.red };
    case 'unsuspend':    return { emoji: '✅', label: '凍結解除', color: C.green };
    case 'delete_post':  return { emoji: '🗑️', label: '投稿削除', color: C.red };
    case 'delete_all':   return { emoji: '🧹', label: '全削除',   color: C.red };
    case 'reset_state':  return { emoji: '🔄', label: 'リセット', color: C.accent };
    case 'send_message': return { emoji: '📧', label: 'DM 送信',  color: C.blue };
    case 'note':         return { emoji: '📝', label: 'メモ',     color: C.text2 };
    default:             return { emoji: '•',  label: action,     color: C.text3 };
  }
}

// 期間フィルタ: 「今月 / 今週 / 今日 / すべて」 を ISO 文字列 → boolean に。
function inDateRange(iso: string, filter: DateFilter): boolean {
  if (filter === 'all') return true;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return true;
  const now = Date.now();
  const day = 86_400_000;
  if (filter === 'today') return now - t < day;
  if (filter === 'week')  return now - t < day * 7;
  if (filter === 'month') return now - t < day * 30;
  return true;
}

const isWeb = Platform.OS === 'web';

// ============================================================
// Screen
// ============================================================
export default function AdminUserDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const userId = typeof params.id === 'string' ? params.id : '';
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('posts');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  // Sticky compact header — fade in when hero is mostly scrolled out.
  const stickyStyle = useAnimatedStyle(() => {
    const op = interpolate(scrollY.value, [120, 200], [0, 1], Extrapolation.CLAMP);
    const ty = interpolate(scrollY.value, [120, 200], [-8, 0], Extrapolation.CLAMP);
    return { opacity: op, transform: [{ translateY: ty }] };
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-user', userId],
    queryFn: () => fetchUserDetail(userId),
    enabled: userId.length > 0,
    staleTime: 15_000,
  });

  const stateMeta = data
    ? STATE_META[data.user.account_state] ?? {
        label: data.user.account_state, color: C.text3, bg: C.bg3, ring: C.border2,
      }
    : null;

  // counts for tab badges (期間フィルタ適用後)
  const filteredPosts = useMemo(
    () => (data?.posts ?? []).filter((p) => inDateRange(p.created_at, dateFilter)),
    [data?.posts, dateFilter],
  );
  const filteredConcerns = useMemo(
    () => (data?.recentReports ?? []).filter((c) => inDateRange(c.created_at, dateFilter)),
    [data?.recentReports, dateFilter],
  );
  const filteredMod = useMemo(
    () => (data?.moderationHistory ?? []).filter((m) => inDateRange(m.created_at, dateFilter)),
    [data?.moderationHistory, dateFilter],
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="ユーザー詳細" left={<BackButton />} />

      {/* Sticky compact header (web/desktop で特に効くが mobile でも動く) */}
      {data && stateMeta && (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: insets.top + 48,
              left: 0, right: 0,
              zIndex: 50,
              paddingHorizontal: SP['4'],
              paddingVertical: SP['2'],
              backgroundColor: C.bg + 'EE',
              borderBottomWidth: 1,
              borderBottomColor: C.border,
              flexDirection: 'row',
              alignItems: 'center',
              gap: SP['2'],
            },
            stickyStyle,
          ]}
        >
          <Avatar size={32} anonymous name={data.user.nickname ?? '?'} />
          <Text style={[T.bodyB, { color: C.text, flex: 1 }]} numberOfLines={1}>
            {data.user.nickname ?? '(no nickname)'}
          </Text>
          <View
            style={{
              paddingHorizontal: SP['2'], paddingVertical: 2,
              backgroundColor: stateMeta.bg, borderRadius: R.full,
              borderWidth: 1, borderColor: stateMeta.color + '55',
            }}
          >
            <Text style={[T.caption, { color: stateMeta.color, fontWeight: '700' }]}>
              {stateMeta.label}
            </Text>
          </View>
        </Animated.View>
      )}

      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Spinner />
        </View>
      ) : error || !data ? (
        <View style={{ padding: SP['8'], alignItems: 'center', gap: SP['3'] }}>
          <Text style={{ fontSize: 36 }}>⚠️</Text>
          <Text style={[T.body, { color: C.text2, textAlign: 'center' }]}>
            ユーザーを取得できませんでした
          </Text>
          <PressableScale
            onPress={() => void refetch()}
            haptic="tap"
            style={{
              paddingHorizontal: SP['4'], paddingVertical: SP['2'],
              backgroundColor: C.bg3, borderRadius: R.full,
              borderWidth: 1, borderColor: C.border,
            }}
          >
            <Text style={[T.smallM, { color: C.text }]}>再読み込み</Text>
          </PressableScale>
        </View>
      ) : (
        <Animated.ScrollView
          onScroll={onScroll}
          scrollEventThrottle={16}
          contentContainerStyle={{
            paddingBottom: insets.bottom + SP['10'],
            paddingTop: SP['3'],
            gap: SP['4'],
          }}
        >
          <ProfileHero user={data.user} moderation={data.moderationHistory} posts={data.posts} />
          <ActionGrid user={data.user} />
          <FilterBar tab={tab} filter={dateFilter} onChangeFilter={setDateFilter} />
          <TabBar
            tab={tab}
            onChange={setTab}
            counts={{
              posts: filteredPosts.length,
              concerns: filteredConcerns.length,
              moderation: filteredMod.length,
            }}
          />
          {tab === 'posts' && (
            <PostsTab posts={filteredPosts} userId={data.user.id} />
          )}
          {tab === 'concerns' && (
            <ConcernsTab concerns={filteredConcerns} posts={data.posts} />
          )}
          {tab === 'moderation' && (
            <ModerationTab logs={filteredMod} userId={data.user.id} />
          )}
        </Animated.ScrollView>
      )}
    </View>
  );
}

// ============================================================
// Hero card
// ============================================================
function ProfileHero({
  user, moderation, posts,
}: {
  user: AdminUser; moderation: ModerationLog[]; posts: AdminPost[];
}) {
  // 凍結回数 = suspend アクションがこのユーザーに対して何度入ったか
  const suspendCount = useMemo(
    () => moderation.filter((m) => m.action === 'suspend' && m.target_id === user.id).length,
    [moderation, user.id],
  );
  // 累計いいね — posts から sum (Admin API は totalLikes を返さないので集計)
  const totalLikes = useMemo(
    () => posts.reduce((acc, p) => acc + (p.likes_count ?? 0), 0),
    [posts],
  );
  const meta = STATE_META[user.account_state] ?? {
    label: user.account_state, color: C.text3, bg: C.bg3, ring: C.border2,
  };
  const ageDays = daysSince(user.created_at);

  // 健全度比 — 通報 / 投稿 (低いほど健全)。0..1 にクランプして円弧に。
  const ratio = user.post_count > 0 ? user.concern_received_count / user.post_count : 0;
  const healthScore = Math.max(0, Math.min(1, 1 - ratio));
  const healthPct = Math.round(healthScore * 100);
  const healthColor = healthScore > 0.85 ? C.green : healthScore > 0.6 ? C.amber : C.red;

  return (
    <Animated.View
      entering={FadeInDown.duration(300)}
      style={{ paddingHorizontal: SP['4'] }}
    >
      <View
        style={[{
          backgroundColor: C.bg2,
          borderRadius: R.xl,
          borderWidth: 1,
          borderColor: C.border,
          padding: SP['4'],
          gap: SP['3'],
          overflow: 'hidden',
        }, SHADOW.card]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['4'] }}>
          {/* state-ring avatar */}
          <View
            style={{
              width: 104, height: 104,
              borderRadius: 52,
              borderWidth: 3,
              borderColor: meta.ring,
              alignItems: 'center', justifyContent: 'center',
              backgroundColor: meta.bg,
            }}
          >
            <Avatar size={96} anonymous name={user.nickname ?? '?'} />
          </View>

          {/* Name + state + meta row */}
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={[T.h1, { color: C.text, fontSize: 24, fontWeight: '800' }]} numberOfLines={1}>
              {user.nickname ?? '(no nickname)'}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'], flexWrap: 'wrap' }}>
              <View
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 6,
                  paddingHorizontal: SP['2'], paddingVertical: 3,
                  backgroundColor: meta.bg, borderRadius: R.full,
                  borderWidth: 1, borderColor: meta.color + '55',
                }}
              >
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: meta.color }} />
                <Text style={[T.captionM, { color: meta.color, fontWeight: '700' }]}>
                  {meta.label}
                </Text>
              </View>
            </View>
            <Text style={[T.caption, { color: C.text3 }]}>
              {ageDays} 日目 · 信頼スコア {user.trust_score}
            </Text>
          </View>

          {/* Health gauge (web 限定: 余裕がある時のみ) */}
          {isWeb && (
            <View style={{ alignItems: 'center', gap: 2 }}>
              <HealthGauge percent={healthPct} color={healthColor} />
              <Text style={[T.caption, { color: C.text3 }]}>健全度</Text>
            </View>
          )}
        </View>

        {/* Stat pills row */}
        <View style={{ flexDirection: 'row', gap: SP['2'] }}>
          <StatPill value={user.post_count} label="投稿" />
          <StatPill
            value={user.concern_received_count}
            label="通報"
            tone={user.concern_received_count > 0 ? 'red' : undefined}
          />
          <StatPill
            value={suspendCount}
            label="凍結"
            tone={suspendCount > 0 ? 'amber' : undefined}
          />
          <StatPill value={totalLikes} label="♥" />
        </View>

        {/* id row for copy/debug */}
        <Text
          style={[T.mono, { color: C.text4, fontSize: 10, textAlign: 'center' }]}
          numberOfLines={1}
        >
          {user.id}
        </Text>
      </View>
    </Animated.View>
  );
}

// SVG なしで作る健全度ゲージ — 4 dot + center number で円グラフ的に見せる
function HealthGauge({ percent, color }: { percent: number; color: string }) {
  return (
    <View
      style={{
        width: 64, height: 64,
        borderRadius: 32,
        borderWidth: 4,
        borderColor: color + '33',
        borderTopColor: color,
        borderRightColor: percent > 60 ? color : color + '33',
        borderBottomColor: percent > 30 ? color : color + '33',
        alignItems: 'center', justifyContent: 'center',
        transform: [{ rotate: '-45deg' }],
      }}
    >
      <Text
        style={[
          T.numLg,
          { color, fontWeight: '800', fontSize: 16, transform: [{ rotate: '45deg' }] },
        ]}
      >
        {percent}
      </Text>
    </View>
  );
}

function StatPill({ value, label, tone }: { value: number; label: string; tone?: 'red' | 'amber' }) {
  const color = tone === 'red' ? C.red : tone === 'amber' ? C.amber : C.text;
  return (
    <View
      style={{
        flex: 1,
        paddingVertical: SP['2'],
        paddingHorizontal: SP['2'],
        backgroundColor: C.bg3,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
        alignItems: 'center',
        gap: 2,
      }}
    >
      <Text style={[T.numLg, { color, fontWeight: '800', fontSize: 20 }]}>{value}</Text>
      <Text style={[T.caption, { color: C.text3, fontSize: 10 }]}>{label}</Text>
    </View>
  );
}

// ============================================================
// Action grid (2x2 premium cards)
// ============================================================
function ActionGrid({ user }: { user: AdminUser }) {
  const router = useRouter();
  const qc = useQueryClient();
  const show = useToastStore((s) => s.show);

  const [pendingSuspend, setPendingSuspend] = useState(false);
  const [pendingUnsuspend, setPendingUnsuspend] = useState(false);
  const [pendingReset, setPendingReset] = useState(false);
  const [pendingDeleteAll, setPendingDeleteAll] = useState(false);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-user', user.id] });

  const suspend = useMutation({
    mutationFn: () => suspendUser(user.id),
    onSuccess: () => { show('凍結しました', 'warn'); void invalidate(); },
    onError: () => show('凍結に失敗しました', 'error'),
  });
  const unsuspend = useMutation({
    mutationFn: () => unsuspendUser(user.id),
    onSuccess: () => { show('凍結を解除しました', 'success'); void invalidate(); },
    onError: () => show('解除に失敗しました', 'error'),
  });
  const reset = useMutation({
    mutationFn: () => resetAccountState(user.id),
    onSuccess: () => { show('アカウント状態をリセットしました', 'success'); void invalidate(); },
    onError: () => show('リセットに失敗しました', 'error'),
  });
  const deleteAll = useMutation({
    mutationFn: () => deleteAllUserPosts(user.id),
    onSuccess: (r) => { show(`${r.deleted} 件の投稿を削除しました`, 'success'); void invalidate(); },
    onError: () => show('削除に失敗しました', 'error'),
  });

  const isSuspended = user.account_state === 'suspended';

  return (
    <Animated.View entering={FadeIn.duration(300).delay(60)} style={{ paddingHorizontal: SP['4'] }}>
      <Text style={[T.smallB, { color: C.text2, letterSpacing: 0.5, marginBottom: SP['2'] }]}>
        アクション
      </Text>
      <View style={{ gap: SP['2'] }}>
        <View style={{ flexDirection: 'row', gap: SP['2'] }}>
          <ActionCard
            emoji="📧"
            title="DM を送る"
            description="メッセージを送信"
            onPress={() => router.push(`/admin/message/${user.id}` as never)}
          />
          {isSuspended ? (
            <ActionCard
              emoji="✅"
              title="凍結を解除"
              description="通常利用に戻す"
              tone="green"
              busy={unsuspend.isPending}
              onPress={() => setPendingUnsuspend(true)}
            />
          ) : (
            <ActionCard
              emoji="🚫"
              title="凍結"
              description="アカウントを停止"
              tone="red"
              busy={suspend.isPending}
              onPress={() => setPendingSuspend(true)}
            />
          )}
        </View>
        <View style={{ flexDirection: 'row', gap: SP['2'] }}>
          <ActionCard
            emoji="🔄"
            title="状態リセット"
            description="通報数を 0 に"
            busy={reset.isPending}
            onPress={() => setPendingReset(true)}
          />
          <ActionCard
            emoji="🗑️"
            title="全投稿削除"
            description="取り消し不可"
            tone="red"
            busy={deleteAll.isPending}
            onPress={() => setPendingDeleteAll(true)}
          />
        </View>
      </View>

      <ConfirmDialog
        visible={pendingSuspend}
        title="アカウントを凍結"
        message={`「${user.nickname ?? user.id}」を凍結します。投稿や反応ができなくなります。`}
        confirmLabel="凍結する"
        destructive
        onConfirm={() => { suspend.mutate(); setPendingSuspend(false); }}
        onCancel={() => setPendingSuspend(false)}
      />
      <ConfirmDialog
        visible={pendingUnsuspend}
        title="凍結を解除"
        message={`「${user.nickname ?? user.id}」の凍結を解除し、通常利用に戻します。`}
        confirmLabel="解除する"
        onConfirm={() => { unsuspend.mutate(); setPendingUnsuspend(false); }}
        onCancel={() => setPendingUnsuspend(false)}
      />
      <ConfirmDialog
        visible={pendingReset}
        title="アカウント状態をリセット"
        message={'通報カウントを 0 に戻し、状態を「正常」にします。モデレーション履歴自体は保持されます。'}
        confirmLabel="リセットする"
        destructive
        onConfirm={() => { reset.mutate(); setPendingReset(false); }}
        onCancel={() => setPendingReset(false)}
      />
      <ConfirmDialog
        visible={pendingDeleteAll}
        title="全投稿を削除"
        message={`${user.post_count} 件の投稿を完全に削除しますか？この操作は取り消せません。`}
        confirmLabel="全て削除する"
        destructive
        onConfirm={() => { deleteAll.mutate(); setPendingDeleteAll(false); }}
        onCancel={() => setPendingDeleteAll(false)}
      />
    </Animated.View>
  );
}

function ActionCard({
  emoji, title, description, onPress, busy, tone,
}: {
  emoji: string;
  title: string;
  description: string;
  onPress: () => void;
  busy?: boolean;
  tone?: 'red' | 'green';
}) {
  const accent = tone === 'red' ? C.red : tone === 'green' ? C.green : C.accent;
  const accentBg = tone === 'red' ? C.redBg : tone === 'green' ? C.greenBg : C.accentSoft;
  return (
    <PressableScale
      onPress={onPress}
      haptic={tone === 'red' ? 'warn' : 'tap'}
      disabled={busy}
      style={[{
        flex: 1,
        padding: SP['3'],
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
        gap: 6,
        minHeight: 88,
        opacity: busy ? 0.6 : 1,
        // hover affordance on web — cursor pointer + subtle accent border
        ...(isWeb ? ({ cursor: 'pointer' } as object) : null),
      }, SHADOW.card]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
        <View
          style={{
            width: 28, height: 28,
            borderRadius: R.md,
            backgroundColor: accentBg,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 16 }}>{emoji}</Text>
        </View>
        {busy && <ActivityIndicator size="small" color={accent} />}
      </View>
      <Text style={[T.bodyB, { color: tone ? accent : C.text, fontWeight: '700' }]} numberOfLines={1}>
        {title}
      </Text>
      <Text style={[T.caption, { color: C.text3 }]} numberOfLines={1}>
        {description}
      </Text>
    </PressableScale>
  );
}

// ============================================================
// Filter bar — period filter pills
// ============================================================
function FilterBar({
  tab, filter, onChangeFilter,
}: {
  tab: Tab;
  filter: DateFilter;
  onChangeFilter: (f: DateFilter) => void;
}) {
  const tabLabel = tab === 'posts' ? '投稿' : tab === 'concerns' ? '通報履歴' : 'モデレーション';
  return (
    <View style={{ paddingHorizontal: SP['4'], gap: SP['2'] }}>
      <Text style={[T.caption, { color: C.text3 }]}>
        表示中: <Text style={[T.captionM, { color: C.text }]}>{tabLabel}</Text>
      </Text>
      <View style={{ flexDirection: 'row', gap: SP['1'] }}>
        <FilterPill active={filter === 'all'}   label="すべて" onPress={() => onChangeFilter('all')} />
        <FilterPill active={filter === 'month'} label="今月"   onPress={() => onChangeFilter('month')} />
        <FilterPill active={filter === 'week'}  label="今週"   onPress={() => onChangeFilter('week')} />
        <FilterPill active={filter === 'today'} label="今日"   onPress={() => onChangeFilter('today')} />
      </View>
    </View>
  );
}

function FilterPill({
  active, label, onPress,
}: { active: boolean; label: string; onPress: () => void }) {
  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      style={{
        paddingHorizontal: SP['3'],
        paddingVertical: 6,
        backgroundColor: active ? C.accentSoft : C.bg2,
        borderRadius: R.full,
        borderWidth: 1,
        borderColor: active ? C.accent + '88' : C.border,
        ...(isWeb ? ({ cursor: 'pointer' } as object) : null),
      }}
    >
      <Text style={[T.caption, { color: active ? C.accentLight : C.text2, fontWeight: '700' }]}>
        {label}
      </Text>
    </PressableScale>
  );
}

// ============================================================
// Tab bar with count badges
// ============================================================
function TabBar({
  tab, onChange, counts,
}: {
  tab: Tab;
  onChange: (t: Tab) => void;
  counts: { posts: number; concerns: number; moderation: number };
}) {
  return (
    <View style={{ flexDirection: 'row', paddingHorizontal: SP['4'], gap: SP['2'] }}>
      <TabPill active={tab === 'posts'}      label="投稿"           count={counts.posts}      onPress={() => onChange('posts')} />
      <TabPill active={tab === 'concerns'}   label="通報履歴"        count={counts.concerns}   onPress={() => onChange('concerns')} />
      <TabPill active={tab === 'moderation'} label="モデレーション" count={counts.moderation} onPress={() => onChange('moderation')} />
    </View>
  );
}

function TabPill({
  active, label, count, onPress,
}: {
  active: boolean; label: string; count: number; onPress: () => void;
}) {
  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      style={[
        {
          flex: 1,
          paddingHorizontal: SP['3'],
          paddingVertical: SP['2'],
          backgroundColor: active ? C.accent : C.bg2,
          borderRadius: R.full,
          borderWidth: 1,
          borderColor: active ? C.accent : C.border,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          ...(isWeb ? ({ cursor: 'pointer' } as object) : null),
        },
        active ? SHADOW.accentGlow : null,
      ]}
    >
      <Text style={[T.smallM, { color: active ? '#fff' : C.text, fontWeight: '700' }]}>
        {label}
      </Text>
      <View
        style={{
          minWidth: 22,
          paddingHorizontal: 6,
          paddingVertical: 1,
          borderRadius: R.full,
          backgroundColor: active ? 'rgba(255,255,255,0.22)' : C.bg3,
          alignItems: 'center',
        }}
      >
        <Text style={[T.caption, { color: active ? '#fff' : C.text3, fontWeight: '700' }]}>
          {count}
        </Text>
      </View>
    </PressableScale>
  );
}

// ============================================================
// Tab 1: 投稿
// ============================================================
function PostsTab({ posts, userId }: { posts: AdminPost[]; userId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<AdminPost | null>(null);
  const qc = useQueryClient();
  const show = useToastStore((s) => s.show);

  const remove = useMutation({
    mutationFn: deletePost,
    onSuccess: () => {
      show('投稿を削除しました', 'success');
      void qc.invalidateQueries({ queryKey: ['admin-user', userId] });
    },
    onError: () => show('削除に失敗しました', 'error'),
  });

  if (posts.length === 0) {
    return <EmptyState icon="📭" title="投稿がありません" hint="この期間の投稿は見つかりません" />;
  }

  return (
    <View style={{ paddingHorizontal: SP['4'], gap: SP['2'] }}>
      {posts.map((p, i) => {
        const isRemovingThis = remove.isPending && remove.variables === p.id;
        const visBg =
          p.visibility === 'public' ? C.greenBg :
          p.visibility === 'private' ? C.bg3 : C.amberBg;
        const visColor =
          p.visibility === 'public' ? C.green :
          p.visibility === 'private' ? C.text3 : C.amber;
        return (
          <Animated.View
            key={p.id}
            entering={FadeInDown.duration(220).delay(i * 20)}
            layout={Layout.springify()}
            style={[{
              padding: SP['3'],
              backgroundColor: C.bg2,
              borderRadius: R.lg,
              borderWidth: 1,
              borderColor: C.border,
              gap: SP['2'],
            }, SHADOW.card]}
          >
            <PressableScale
              onPress={() => router.push(`/admin/post/${p.id}` as never)}
              haptic="tap"
              style={{ gap: SP['2'], ...(isWeb ? ({ cursor: 'pointer' } as object) : null) }}
            >
              <Text style={[T.body, { color: C.text, lineHeight: 21 }]} numberOfLines={3}>
                {p.content || '(本文なし)'}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['3'], flexWrap: 'wrap' }}>
                <MiniMetric icon="♥" value={p.likes_count} />
                <MiniMetric
                  icon="🚩"
                  value={p.concern_count}
                  accent={p.concern_count > 0 ? C.red : undefined}
                />
                <Text style={[T.caption, { color: C.text4 }]}>{formatRelative(p.created_at)}</Text>
                <View style={{ flex: 1 }} />
                <View
                  style={{
                    paddingHorizontal: SP['2'], paddingVertical: 2,
                    backgroundColor: visBg, borderRadius: R.full,
                    borderWidth: 1, borderColor: visColor + '55',
                  }}
                >
                  <Text style={[T.caption, { color: visColor, fontWeight: '700', fontSize: 10 }]}>
                    {p.visibility}
                  </Text>
                </View>
              </View>
            </PressableScale>

            <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
              <PressableScale
                onPress={() => setPending(p)}
                haptic="warn"
                disabled={isRemovingThis}
                style={{
                  paddingHorizontal: SP['3'], paddingVertical: 6,
                  backgroundColor: C.redBg, borderRadius: R.full,
                  borderWidth: 1, borderColor: C.red + '55',
                  flexDirection: 'row', alignItems: 'center', gap: 6,
                  opacity: isRemovingThis ? 0.6 : 1,
                  ...(isWeb ? ({ cursor: 'pointer' } as object) : null),
                }}
              >
                {isRemovingThis && <ActivityIndicator size="small" color={C.red} />}
                <Text style={[T.smallB, { color: C.red }]}>🗑️ 削除</Text>
              </PressableScale>
            </View>
          </Animated.View>
        );
      })}
      <ConfirmDialog
        visible={pending !== null}
        title="投稿を削除"
        message="この投稿を完全に削除します。元には戻せません。"
        confirmLabel="削除する"
        destructive
        onConfirm={() => {
          if (pending) remove.mutate(pending.id);
          setPending(null);
        }}
        onCancel={() => setPending(null)}
      />
    </View>
  );
}

// ============================================================
// Tab 2: 通報履歴
// ============================================================
// ConcernSummary は { user_id (reporter), post_id, reason, created_at }。
// post 本文は親 data の posts から lookup、reporter は id slice で表示。
function ConcernsTab({ concerns, posts }: { concerns: ConcernSummary[]; posts: AdminPost[] }) {
  const postMap = useMemo(() => {
    const m = new Map<string, AdminPost>();
    for (const p of posts) m.set(p.id, p);
    return m;
  }, [posts]);

  // 投稿単位でグルーピング — 1 つの投稿が複数人から通報される時の繰返しを抑える
  const grouped = useMemo(() => {
    const map = new Map<string, { post_id: string; reporters: ConcernSummary[] }>();
    for (const c of concerns) {
      const existing = map.get(c.post_id);
      if (existing) {
        existing.reporters.push(c);
      } else {
        map.set(c.post_id, { post_id: c.post_id, reporters: [c] });
      }
    }
    return Array.from(map.values());
  }, [concerns]);

  if (grouped.length === 0) {
    return <EmptyState icon="🕊️" title="通報されていません" hint="この期間の通報は見つかりません" />;
  }

  return (
    <View style={{ paddingHorizontal: SP['4'], gap: SP['2'] }}>
      {grouped.map((g, i) => {
        const post = postMap.get(g.post_id);
        return (
          <Animated.View
            key={g.post_id}
            entering={FadeInDown.duration(220).delay(i * 20)}
            layout={Layout.springify()}
            style={[{
              padding: SP['3'],
              backgroundColor: C.bg2,
              borderRadius: R.lg,
              borderWidth: 1,
              borderColor: C.border,
              gap: SP['2'],
            }, SHADOW.card]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
              <View
                style={{
                  paddingHorizontal: SP['2'], paddingVertical: 2,
                  backgroundColor: C.redBg, borderRadius: R.full,
                  borderWidth: 1, borderColor: C.red + '55',
                }}
              >
                <Text style={{ fontSize: 10, color: C.red, fontWeight: '800' }}>
                  🚩 {g.reporters.length} 件
                </Text>
              </View>
              <Text style={[T.captionM, { color: C.text3, flex: 1 }]} numberOfLines={1}>
                投稿 {g.post_id.slice(0, 8)}
              </Text>
            </View>
            <Text style={[T.body, { color: C.text, lineHeight: 21 }]} numberOfLines={2}>
              {post?.content || '(本文を取得できませんでした)'}
            </Text>
            <View
              style={{
                gap: 6, paddingTop: SP['2'],
                borderTopWidth: 1, borderTopColor: C.divider,
              }}
            >
              {g.reporters.map((r, idx) => (
                <View
                  key={`${r.user_id}-${idx}`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}
                >
                  <Avatar size={24} anonymous name={r.user_id} />
                  <Text style={[T.mono, { color: C.text2, fontSize: 11, flex: 1 }]} numberOfLines={1}>
                    {r.user_id.slice(0, 8)}
                  </Text>
                  {r.reason && (
                    <View
                      style={{
                        paddingHorizontal: SP['2'], paddingVertical: 1,
                        backgroundColor: C.bg3, borderRadius: R.full,
                        borderWidth: 1, borderColor: C.border,
                      }}
                    >
                      <Text style={[T.caption, { color: C.text2, fontSize: 10 }]} numberOfLines={1}>
                        {r.reason}
                      </Text>
                    </View>
                  )}
                  <Text style={[T.caption, { color: C.text4, fontSize: 10 }]}>
                    {formatRelative(r.created_at)}
                  </Text>
                </View>
              ))}
            </View>
          </Animated.View>
        );
      })}
    </View>
  );
}

// ============================================================
// Tab 3: モデレーション履歴 (timeline)
// ============================================================
function ModerationTab({ logs, userId }: { logs: ModerationLog[]; userId: string }) {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();
  const show = useToastStore((s) => s.show);

  // メモを moderation_log に 'note' action として書き込む。
  // sendAdminMessage 系は本人に通知が飛ぶので使えない — 直接 insert。
  const saveNote = async () => {
    const trimmed = note.trim();
    if (trimmed.length === 0 || saving) return;
    setSaving(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const adminId = auth.user?.id;
      if (!adminId) throw new Error('not signed in');
      const { error } = await supabase.from('moderation_log').insert({
        admin_id: adminId,
        action: 'note',
        target_type: 'user',
        target_id: userId,
        reason: trimmed,
      });
      if (error) throw error;
      setNote('');
      show('メモを保存しました', 'success');
      void qc.invalidateQueries({ queryKey: ['admin-user', userId] });
    } catch {
      show('メモの保存に失敗しました', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ paddingHorizontal: SP['4'], gap: SP['3'] }}>
      {/* note composer */}
      <View
        style={[{
          backgroundColor: C.bg2,
          borderRadius: R.lg,
          borderWidth: 1,
          borderColor: C.border,
          padding: SP['3'],
          gap: SP['2'],
        }, SHADOW.card]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontSize: 14 }}>📝</Text>
          <Text style={[T.smallB, { color: C.text2 }]}>メモを残す</Text>
        </View>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="このユーザーに関する社内メモ…"
          placeholderTextColor={C.text4}
          multiline
          style={[
            T.body,
            {
              color: C.text,
              backgroundColor: C.bg3,
              borderRadius: R.md,
              borderWidth: 1,
              borderColor: C.border,
              padding: SP['3'],
              minHeight: 72,
              textAlignVertical: 'top',
            },
          ]}
        />
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
          <PressableScale
            onPress={() => { void saveNote(); }}
            haptic="confirm"
            disabled={saving || note.trim().length === 0}
            style={[
              {
                paddingHorizontal: SP['4'], paddingVertical: SP['2'],
                backgroundColor: note.trim().length === 0 ? C.bg3 : C.accent,
                borderRadius: R.full,
                borderWidth: 1,
                borderColor: note.trim().length === 0 ? C.border : C.accent,
                flexDirection: 'row', alignItems: 'center', gap: 6,
                opacity: saving ? 0.6 : 1,
              },
              note.trim().length > 0 ? SHADOW.accentGlow : null,
            ]}
          >
            {saving && <ActivityIndicator size="small" color="#fff" />}
            <Text
              style={[
                T.smallB,
                { color: note.trim().length === 0 ? C.text3 : '#fff' },
              ]}
            >
              保存
            </Text>
          </PressableScale>
        </View>
      </View>

      {logs.length === 0 ? (
        <EmptyState icon="📜" title="履歴はありません" hint="まだ何のアクションも記録されていません" />
      ) : (
        <View style={{ paddingLeft: 4 }}>
          {logs.map((l, i) => {
            const meta = actionMeta(l.action);
            const isLast = i === logs.length - 1;
            return (
              <Animated.View
                key={l.id}
                entering={FadeInDown.duration(220).delay(i * 25)}
                layout={Layout.springify()}
                style={{ flexDirection: 'row', gap: SP['3'] }}
              >
                {/* timeline rail */}
                <View style={{ alignItems: 'center', width: 28 }}>
                  <View
                    style={{
                      width: 28, height: 28,
                      borderRadius: 14,
                      backgroundColor: C.bg3,
                      borderWidth: 1.5,
                      borderColor: meta.color + '88',
                      alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <Text style={{ fontSize: 12 }}>{meta.emoji}</Text>
                  </View>
                  {!isLast && (
                    <View
                      style={{
                        width: 2,
                        flex: 1,
                        minHeight: 24,
                        backgroundColor: C.divider,
                      }}
                    />
                  )}
                </View>

                {/* node body */}
                <View
                  style={[{
                    flex: 1,
                    marginBottom: SP['2'],
                    padding: SP['3'],
                    backgroundColor: C.bg2,
                    borderRadius: R.lg,
                    borderWidth: 1,
                    borderColor: C.border,
                    borderLeftWidth: 3,
                    borderLeftColor: meta.color,
                    gap: 4,
                  }, SHADOW.card]}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
                    <Text style={[T.smallB, { color: meta.color, flex: 1 }]} numberOfLines={1}>
                      {meta.label}
                    </Text>
                    <Text style={[T.caption, { color: C.text4 }]}>
                      {formatRelative(l.created_at)}
                    </Text>
                  </View>
                  <Text style={[T.mono, { color: C.text3, fontSize: 10 }]} numberOfLines={1}>
                    admin: {l.admin_id.slice(0, 8)}
                  </Text>
                  {l.reason && (
                    <Text style={[T.small, { color: C.text2, lineHeight: 18 }]} numberOfLines={6}>
                      {l.reason}
                    </Text>
                  )}
                </View>
              </Animated.View>
            );
          })}
        </View>
      )}
    </View>
  );
}

// ============================================================
// shared helpers
// ============================================================
// MiniMetric は components/admin/MiniMetric.tsx へ切り出し (Phase 8 split)

function EmptyState({ icon, title, hint }: { icon: string; title: string; hint?: string }) {
  return (
    <Animated.View
      entering={FadeIn.duration(260)}
      style={{
        marginHorizontal: SP['4'],
        paddingVertical: SP['10'],
        paddingHorizontal: SP['4'],
        alignItems: 'center',
        gap: SP['2'],
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
        borderStyle: 'dashed',
      }}
    >
      <Text style={{ fontSize: 40 }}>{icon}</Text>
      <Text style={[T.bodyB, { color: C.text2 }]}>{title}</Text>
      {hint && (
        <Text style={[T.caption, { color: C.text4, textAlign: 'center' }]}>{hint}</Text>
      )}
    </Animated.View>
  );
}

// Note: `Icon` import retained — chevron may be referenced if extended later.
void Icon;
