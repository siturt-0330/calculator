import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, LayoutChangeEvent, ScrollView, Text, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { PressableScale } from '../../components/ui/PressableScale';
import { Stat, EmptyBlock, ErrorBlock } from '../../components/admin/AdminBlocks';
import { Spinner } from '../../components/ui/Spinner';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Icon } from '../../constants/icons';
import { useAuthStore } from '../../stores/authStore';
import { useToastStore } from '../../stores/toastStore';
import {
  fetchAllUsers,
  fetchAllPosts,
  suspendUser,
  unsuspendUser,
  deletePost,
  type AdminUser,
  type AdminPost,
} from '../../lib/api/admin';
import {
  fetchAdminDashboardStats,
  fetchReportedPosts,
  fetchProblemUsers,
  fetchModerationLog,
  type AdminReportedPost,
  type AdminProblemUser,
  type AdminModerationLogEntry,
} from '../../lib/api/adminExt';
import { fetchPendingOfficialApps } from '../../lib/api/officialCommunities';
import { formatRelative } from '../../lib/utils/date';
import { C, R, SP, SHADOW } from '../../design/tokens';
import { T, FONT } from '../../design/typography';

type Tab = 'dashboard' | 'reports' | 'users' | 'posts';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'dashboard', label: 'ダッシュボード' },
  { key: 'reports',   label: '通報' },
  { key: 'users',     label: 'ユーザー' },
  { key: 'posts',     label: '投稿' },
];

// ============================================================
// 表示用メタ — state / visibility / moderation action
// ============================================================
const STATE_META: Record<string, { label: string; color: string }> = {
  healthy:    { label: '健康',  color: C.green },
  caution:    { label: '注意',  color: C.amber },
  restricted: { label: '制限',  color: C.amber },
  warned:     { label: '警告',  color: C.red },
  suspended:  { label: '停止',  color: C.text3 },
};

const VISIBILITY_META: Record<string, { label: string; color: string }> = {
  public:           { label: '公開',         color: C.green },
  community_public: { label: 'コミュ+公開', color: C.blue },
  community_only:   { label: 'コミュ限定',   color: C.accent },
  private:          { label: '非公開',       color: C.text3 },
};

const ACTION_META: Record<string, { label: string; color: string; emoji: string }> = {
  suspend_user:        { label: '凍結',         color: C.red,    emoji: '🔒' },
  unsuspend_user:      { label: '凍結解除',     color: C.green,  emoji: '🔓' },
  delete_post:         { label: '投稿削除',     color: C.red,    emoji: '🗑️' },
  delete_thread:       { label: 'スレ削除',     color: C.red,    emoji: '🗑️' },
  delete_comment:      { label: 'コメ削除',     color: C.red,    emoji: '🗑️' },
  send_message:        { label: 'DM 送信',      color: C.blue,   emoji: '✉️' },
  reset_account_state: { label: 'state reset', color: C.amber,  emoji: '♻️' },
  note:                { label: 'メモ',         color: C.text3,  emoji: '📝' },
};

type KpiTone = 'neutral' | 'accent' | 'red' | 'amber' | 'green' | 'blue';
type KpiPalette = { fg: string; bg: string; border: string };
const KPI_PALETTE: Record<KpiTone, KpiPalette> = {
  neutral: { fg: C.text,        bg: C.bg2,      border: C.border },
  accent:  { fg: C.accentLight, bg: C.accentBg, border: C.accent + '55' },
  red:     { fg: C.red,         bg: C.redBg,    border: C.red + '55' },
  amber:   { fg: C.amber,       bg: C.amberBg,  border: C.amber + '55' },
  green:   { fg: C.green,       bg: C.greenBg,  border: C.green + '55' },
  blue:    { fg: C.blue,        bg: C.blueBg,   border: C.blue + '55' },
};

// ============================================================
// メイン screen
// ============================================================
export default function AdminIndexScreen() {
  const insets = useSafeAreaInsets();
  const signOut = useAuthStore((s) => s.signOut);
  const userEmail = useAuthStore((s) => s.user?.email);
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('dashboard');

  const { data: stats } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: fetchAdminDashboardStats,
    staleTime: 30_000,
  });

  // header の reload — 表示中の admin クエリを全て invalidate
  const reloadAll = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['admin-stats'] });
    void qc.invalidateQueries({ queryKey: ['admin-reported'] });
    void qc.invalidateQueries({ queryKey: ['admin-users'] });
    void qc.invalidateQueries({ queryKey: ['admin-posts'] });
    void qc.invalidateQueries({ queryKey: ['admin-problem-users'] });
    void qc.invalidateQueries({ queryKey: ['admin-mod-log'] });
  }, [qc]);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar
        title=" "
        left={<BackButton />}
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
            <PressableScale
              onPress={reloadAll}
              haptic="tap"
              hitSlop={10}
              style={{
                width: 34, height: 34, borderRadius: R.full,
                backgroundColor: C.bg3, alignItems: 'center', justifyContent: 'center',
                borderWidth: 1, borderColor: C.border,
              }}
              accessibilityLabel="再読み込み"
            >
              <Icon.sparkles size={14} color={C.text2} strokeWidth={2.2} />
            </PressableScale>
            <PressableScale
              onPress={() => { void signOut(); }}
              haptic="warn"
              style={{
                paddingHorizontal: SP['3'], paddingVertical: 7,
                backgroundColor: C.bg3, borderRadius: R.full,
                borderWidth: 1, borderColor: C.border,
              }}
            >
              <Text style={[T.caption, { color: C.text2, fontWeight: '700' }]}>ログアウト</Text>
            </PressableScale>
          </View>
        }
      />

      <ScrollView
        stickyHeaderIndices={[2]}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + SP['10'] }}
      >
        {/* ============ Header (title + email + DEV badge) ============ */}
        <View style={{ paddingHorizontal: SP['4'], paddingTop: SP['1'], paddingBottom: SP['3'] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'], marginBottom: 4 }}>
            <Text style={{
              fontFamily: FONT.display,
              fontSize: 30,
              lineHeight: 36,
              color: C.text,
              letterSpacing: -0.6,
            }}>
              Admin Panel
            </Text>
            <View style={{
              paddingHorizontal: SP['2'], paddingVertical: 2,
              backgroundColor: C.redBg, borderRadius: R.sm,
              borderWidth: 1, borderColor: C.red + '55',
            }}>
              <Text style={{ fontSize: 10, color: C.red, fontWeight: '800', letterSpacing: 0.6 }}>DEV</Text>
            </View>
          </View>
          <Text style={[T.caption, { color: C.text3 }]} numberOfLines={1}>
            {userEmail ? `${userEmail} としてログイン中` : 'admin としてログイン中'} · 全データへの書き込み権限
          </Text>
        </View>

        {/* ============ KPI 2x3 grid ============ */}
        <KpiGrid stats={stats} />

        {/* ============ Sticky Tab bar ============ */}
        <View style={{ backgroundColor: C.bg, paddingTop: SP['3'], paddingBottom: SP['2'] }}>
          <TabPills
            tab={tab}
            onChange={setTab}
            openReports={stats?.openReports ?? 0}
          />
        </View>

        {/* ============ Tab content ============ */}
        <View style={{ paddingTop: SP['1'] }}>
          {tab === 'dashboard' ? (
            <DashboardTab stats={stats} onJumpReports={() => setTab('reports')} />
          ) : tab === 'reports' ? (
            <ReportsTab />
          ) : tab === 'users' ? (
            <UsersTab />
          ) : (
            <PostsTab />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

// ============================================================
// KPI 2x3 grid
// ============================================================
function KpiGrid({ stats }: { stats: { totalUsers: number; totalPosts: number; activeUsers24h: number; newPostsToday: number; suspendedUsers: number; openReports: number } | undefined }) {
  const suspendedTone: KpiTone = (stats?.suspendedUsers ?? 0) > 0 ? 'red' : 'neutral';
  const openReportsTone: KpiTone = (stats?.openReports ?? 0) > 0 ? 'amber' : 'neutral';

  return (
    <View style={{
      paddingHorizontal: SP['4'],
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: SP['2'],
    }}>
      <KpiCard label="全ユーザー"     value={stats?.totalUsers}     tone="neutral" hint="過去24h" />
      <KpiCard label="全投稿"         value={stats?.totalPosts}     tone="neutral" hint="過去24h" />
      <KpiCard label="24h アクティブ" value={stats?.activeUsers24h} tone="accent"  hint="last 24h" />
      <KpiCard label="今日の新規投稿" value={stats?.newPostsToday}  tone="blue"    hint="本日" />
      <KpiCard label="凍結中"         value={stats?.suspendedUsers} tone={suspendedTone}    hint="累計" />
      <KpiCard label="未対応の通報"   value={stats?.openReports}    tone={openReportsTone}  hint="要対応" />
    </View>
  );
}

function KpiCard({
  label, value, tone = 'neutral', hint,
}: {
  label: string;
  value: number | undefined;
  tone?: KpiTone;
  hint?: string;
}) {
  const p: KpiPalette = KPI_PALETTE[tone];
  const showValue = value !== undefined ? value.toLocaleString('ja-JP') : '—';
  const isAccent = tone !== 'neutral';
  return (
    <View
      style={[{
        flexBasis: '48%',
        flexGrow: 1,
        backgroundColor: p.bg,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: p.border,
        overflow: 'hidden',
      }, SHADOW.card]}
    >
      {/* 5-10% accent gradient overlay */}
      {isAccent && (
        <LinearGradient
          colors={[p.fg + '14', 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '70%' }}
          pointerEvents="none"
        />
      )}
      <View style={{ padding: SP['3'], gap: 4 }}>
        <Text
          style={{
            fontFamily: FONT.uiBold,
            fontSize: 30,
            lineHeight: 34,
            color: p.fg,
            fontWeight: '700',
            letterSpacing: -0.6,
          }}
          numberOfLines={1}
        >
          {showValue}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SP['2'] }}>
          <Text
            style={{
              fontSize: 10,
              color: C.text3,
              fontWeight: '700',
              letterSpacing: 0.8,
              textTransform: 'uppercase',
              flexShrink: 1,
            }}
            numberOfLines={1}
          >
            {label}
          </Text>
          {hint && (
            <Text style={{ fontSize: 9, color: C.text4, fontWeight: '600' }} numberOfLines={1}>
              {hint}
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}

// ============================================================
// Tab pills with sliding indicator (Reanimated)
// ============================================================
function TabPills({ tab, onChange, openReports }: { tab: Tab; onChange: (t: Tab) => void; openReports: number }) {
  const [widths, setWidths] = useState<number[]>([0, 0, 0, 0]);
  const [positions, setPositions] = useState<number[]>([0, 0, 0, 0]);
  const x = useSharedValue(0);
  const w = useSharedValue(0);
  const activeIndex = TABS.findIndex((t) => t.key === tab);

  useEffect(() => {
    const targetX = positions[activeIndex] ?? 0;
    const targetW = widths[activeIndex] ?? 0;
    x.value = withSpring(targetX, { damping: 22, stiffness: 220 });
    w.value = withTiming(targetW, { duration: 220 });
  }, [activeIndex, positions, widths, x, w]);

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
    width: w.value,
  }));

  const onLayout = (i: number) => (e: LayoutChangeEvent) => {
    const { x: lx, width } = e.nativeEvent.layout;
    setPositions((prev) => {
      const next = [...prev]; next[i] = lx; return next;
    });
    setWidths((prev) => {
      const next = [...prev]; next[i] = width; return next;
    });
  };

  return (
    <View style={{
      marginHorizontal: SP['4'],
      padding: 4,
      backgroundColor: C.bg2,
      borderRadius: R.full,
      borderWidth: 1,
      borderColor: C.border,
      flexDirection: 'row',
      position: 'relative',
    }}>
      <Animated.View
        style={[
          {
            position: 'absolute',
            top: 4,
            bottom: 4,
            left: 0,
            backgroundColor: C.accent,
            borderRadius: R.full,
          },
          indicatorStyle,
          SHADOW.accentGlow,
        ]}
        pointerEvents="none"
      />
      {TABS.map((t, i) => {
        const active = t.key === tab;
        const showBadge = t.key === 'reports' && openReports > 0;
        return (
          <PressableScale
            key={t.key}
            onPress={() => onChange(t.key)}
            haptic="select"
            onLayout={onLayout(i)}
            style={{
              flex: 1,
              paddingVertical: 8,
              paddingHorizontal: SP['2'],
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
            }}
          >
            <Text
              style={[T.smallB, {
                color: active ? '#fff' : C.text2,
                fontSize: 12,
              }]}
              numberOfLines={1}
            >
              {t.label}
            </Text>
            {showBadge && (
              <View style={{
                minWidth: 16,
                paddingHorizontal: 4,
                height: 16,
                borderRadius: R.full,
                backgroundColor: active ? 'rgba(255,255,255,0.25)' : C.red,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <Text style={{ fontSize: 9, color: '#fff', fontWeight: '800' }}>{openReports}</Text>
              </View>
            )}
          </PressableScale>
        );
      })}
    </View>
  );
}

function SectionHeader({ label, right }: { label: string; right?: React.ReactNode }) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: SP['2'],
      paddingHorizontal: SP['4'], paddingBottom: SP['2'], paddingTop: SP['4'],
    }}>
      <Text style={{
        fontSize: 10, fontWeight: '800', color: C.text3,
        letterSpacing: 1.2, textTransform: 'uppercase',
      }}>
        {label}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: C.border }} />
      {right}
    </View>
  );
}

// ============================================================
// Tab 1 — ダッシュボード (Hero + Recent + Top reported)
// ============================================================
type HealthLevel = 'healthy' | 'caution' | 'critical';

function computeHealth(stats: { totalUsers: number; suspendedUsers: number; openReports: number } | undefined): {
  level: HealthLevel; emoji: string; label: string; color: string; bg: string; border: string; description: string;
} {
  if (!stats) {
    return { level: 'healthy', emoji: '🟢', label: 'Loading', color: C.text3, bg: C.bg2, border: C.border, description: 'データ取得中…' };
  }
  const ratio = stats.totalUsers > 0 ? stats.suspendedUsers / stats.totalUsers : 0;
  if (stats.openReports >= 10 || ratio >= 0.1) {
    return {
      level: 'critical', emoji: '🔴', label: '要対応', color: C.red, bg: C.redBg, border: C.red + '66',
      description: `未対応の通報が ${stats.openReports} 件あります`,
    };
  }
  if (stats.openReports >= 1 || ratio >= 0.03) {
    return {
      level: 'caution', emoji: '🟡', label: '注意', color: C.amber, bg: C.amberBg, border: C.amber + '66',
      description: stats.openReports > 0
        ? `未対応の通報が ${stats.openReports} 件あります`
        : `凍結中ユーザー ${stats.suspendedUsers} 名`,
    };
  }
  return {
    level: 'healthy', emoji: '🟢', label: 'Healthy', color: C.green, bg: C.greenBg, border: C.green + '66',
    description: '通報・凍結ともに落ち着いています',
  };
}

function DashboardTab({ stats, onJumpReports }: { stats: { totalUsers: number; totalPosts: number; activeUsers24h: number; newPostsToday: number; suspendedUsers: number; openReports: number } | undefined; onJumpReports: () => void }) {
  const router = useRouter();
  const { data: log } = useQuery({
    queryKey: ['admin-mod-log'],
    queryFn: () => fetchModerationLog({ limit: 10 }),
    staleTime: 30_000,
  });
  const { data: topReports } = useQuery({
    queryKey: ['admin-reported', { top: 3 }],
    queryFn: () => fetchReportedPosts({ minReports: 1, limit: 3 }),
    staleTime: 30_000,
  });
  const { data: pendingApps = [] } = useQuery({
    queryKey: ['admin-pending-official-apps'],
    queryFn: fetchPendingOfficialApps,
    staleTime: 30_000,
  });

  const health = computeHealth(stats);

  return (
    <View>
      {/* Hero — 今週の様子 */}
      <SectionHeader label="今週の様子" />
      <View style={{ paddingHorizontal: SP['4'] }}>
        <View style={[{
          padding: SP['4'],
          backgroundColor: health.bg,
          borderRadius: R.xl,
          borderWidth: 1,
          borderColor: health.border,
          overflow: 'hidden',
        }, SHADOW.card]}>
          <LinearGradient
            colors={[health.color + '22', 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            pointerEvents="none"
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['3'] }}>
            <Text style={{ fontSize: 40 }}>{health.emoji}</Text>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{
                fontFamily: FONT.display2,
                fontSize: 22, lineHeight: 28,
                color: health.color, letterSpacing: -0.3,
              }}>
                {health.label}
              </Text>
              <Text style={[T.small, { color: C.text2 }]}>{health.description}</Text>
            </View>
            {health.level !== 'healthy' && (
              <PressableScale
                onPress={onJumpReports}
                haptic="tap"
                style={{
                  paddingHorizontal: SP['3'], paddingVertical: 7,
                  backgroundColor: health.color,
                  borderRadius: R.full,
                }}
              >
                <Text style={[T.smallB, { color: '#fff' }]}>確認</Text>
              </PressableScale>
            )}
          </View>
        </View>
      </View>

      {/* 公式申請 */}
      <SectionHeader
        label="公式申請"
        right={
          pendingApps.length > 0 ? (
            <PressableScale
              onPress={() => router.push('/admin/official-apps' as never)}
              haptic="tap"
              hitSlop={6}
            >
              <Text style={[T.caption, { color: C.accentLight, fontWeight: '700' }]}>もっと見る →</Text>
            </PressableScale>
          ) : null
        }
      />
      <View style={{ paddingHorizontal: SP['4'] }}>
        <PressableScale
          onPress={() => router.push('/admin/official-apps' as never)}
          haptic="tap"
          style={[{
            padding: SP['3'],
            backgroundColor: C.bg2,
            borderRadius: R.lg,
            borderWidth: 1,
            borderColor: pendingApps.length > 0 ? C.accent + '55' : C.border,
            flexDirection: 'row',
            alignItems: 'center',
            gap: SP['3'],
          }, SHADOW.card]}
        >
          <View
            style={{
              width: 40, height: 40, borderRadius: 20,
              backgroundColor: C.accentBg,
              alignItems: 'center', justifyContent: 'center',
              borderWidth: 1, borderColor: C.accent + '55',
            }}
          >
            <Icon.shield size={18} color={C.accentLight} strokeWidth={2.4} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[T.bodyB, { color: C.text }]}>未対応の公式申請</Text>
            <Text style={[T.caption, { color: C.text3 }]}>
              {pendingApps.length > 0
                ? `${pendingApps.length} 件 — 承認 / 却下を判断してください`
                : '現在、未対応の申請はありません'}
            </Text>
          </View>
          {pendingApps.length > 0 && (
            <View
              style={{
                minWidth: 24, paddingHorizontal: 6, height: 24, borderRadius: 12,
                backgroundColor: C.accent,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>
                {pendingApps.length}
              </Text>
            </View>
          )}
          <Icon.chevronR size={18} color={C.text3} strokeWidth={2.2} />
        </PressableScale>
      </View>

      {/* 広告管理 */}
      <SectionHeader label="広告管理" />
      <View style={{ paddingHorizontal: SP['4'] }}>
        <PressableScale
          onPress={() => router.push('/admin/ads' as never)}
          haptic="tap"
          style={[{
            padding: SP['3'],
            backgroundColor: C.bg2,
            borderRadius: R.lg,
            borderWidth: 1,
            borderColor: C.border,
            flexDirection: 'row',
            alignItems: 'center',
            gap: SP['3'],
          }, SHADOW.card]}
        >
          <View
            style={{
              width: 40, height: 40, borderRadius: 20,
              backgroundColor: C.accentBg,
              alignItems: 'center', justifyContent: 'center',
              borderWidth: 1, borderColor: C.accent + '55',
            }}
          >
            <Icon.sparkles size={18} color={C.accentLight} strokeWidth={2.4} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[T.bodyB, { color: C.text }]}>タグターゲティング広告</Text>
            <Text style={[T.caption, { color: C.text3 }]}>
              広告の作成・編集と配信実績の確認
            </Text>
          </View>
          <Icon.chevronR size={18} color={C.text3} strokeWidth={2.2} />
        </PressableScale>
      </View>

      {/* Top reported */}
      <SectionHeader
        label="Top Reported"
        right={
          (topReports?.length ?? 0) > 0 ? (
            <PressableScale onPress={onJumpReports} haptic="tap" hitSlop={6}>
              <Text style={[T.caption, { color: C.accentLight, fontWeight: '700' }]}>もっと見る →</Text>
            </PressableScale>
          ) : null
        }
      />
      <View style={{ paddingHorizontal: SP['4'], gap: SP['2'] }}>
        {topReports === undefined ? (
          <View style={{ paddingVertical: SP['6'], alignItems: 'center' }}><Spinner /></View>
        ) : topReports.length === 0 ? (
          <View style={{
            padding: SP['5'], alignItems: 'center', gap: SP['1'],
            backgroundColor: C.bg2, borderRadius: R.lg,
            borderWidth: 1, borderColor: C.border,
          }}>
            <Text style={{ fontSize: 28 }}>✨</Text>
            <Text style={[T.small, { color: C.text3 }]}>通報されている投稿はありません</Text>
          </View>
        ) : (
          topReports.map((r) => (
            <PressableScale
              key={r.post_id}
              onPress={() => router.push(`/admin/post/${r.post_id}` as never)}
              haptic="tap"
              style={[{
                padding: SP['3'],
                backgroundColor: C.bg2,
                borderRadius: R.lg,
                borderWidth: 1,
                borderColor: C.border,
                gap: 6,
              }, SHADOW.card]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
                <ReportCountBadge count={r.reports_count} />
                <Text style={[T.captionM, { color: C.text3, flex: 1 }]} numberOfLines={1}>
                  {r.author_nickname ?? '(unknown)'} · {formatRelative(r.last_reported_at)}
                </Text>
              </View>
              <Text style={[T.small, { color: C.text2 }]} numberOfLines={2}>
                {previewText(r.content)}
              </Text>
            </PressableScale>
          ))
        )}
      </View>

      {/* Recent activity */}
      <SectionHeader label="Recent Activity" />
      <View style={{ paddingHorizontal: SP['4'] }}>
        <View style={{
          backgroundColor: C.bg2,
          borderRadius: R.lg,
          borderWidth: 1,
          borderColor: C.border,
          overflow: 'hidden',
        }}>
          {log === undefined ? (
            <View style={{ paddingVertical: SP['6'], alignItems: 'center' }}><Spinner /></View>
          ) : log.length === 0 ? (
            <Text style={[T.small, { color: C.text3, padding: SP['4'], textAlign: 'center' }]}>履歴はまだありません</Text>
          ) : (
            log.map((e, idx) => <ActivityRow key={e.id} entry={e} last={idx === log.length - 1} />)
          )}
        </View>
      </View>
    </View>
  );
}

function ActivityRow({ entry, last }: { entry: AdminModerationLogEntry; last: boolean }) {
  const meta = ACTION_META[entry.action] ?? { label: entry.action, color: C.text3, emoji: '·' };
  return (
    <View style={{
      paddingHorizontal: SP['3'], paddingVertical: SP['2'],
      flexDirection: 'row', alignItems: 'center', gap: SP['2'],
      borderBottomWidth: last ? 0 : 1, borderBottomColor: C.divider,
    }}>
      <Text style={{ fontSize: 16 }}>{meta.emoji}</Text>
      <View style={{
        paddingHorizontal: SP['2'], paddingVertical: 1,
        backgroundColor: meta.color + '22', borderRadius: R.sm,
        borderWidth: 1, borderColor: meta.color + '55',
      }}>
        <Text style={{ fontSize: 10, color: meta.color, fontWeight: '700' }}>{meta.label}</Text>
      </View>
      <Text style={[T.caption, { color: C.text2, flex: 1 }]} numberOfLines={1}>
        {entry.target_type} · {entry.target_id.slice(0, 8)}…
      </Text>
      <Text style={[T.caption, { color: C.text4 }]}>{formatRelative(entry.created_at)}</Text>
    </View>
  );
}

// ============================================================
// Tab 2 — 通報
// ============================================================
function ReportsTab() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [minReports, setMinReports] = useState<1 | 3 | 5>(1);
  const [pendingDelete, setPendingDelete] = useState<AdminReportedPost | null>(null);
  const qc = useQueryClient();
  const show = useToastStore((s) => s.show);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-reported', { minReports, search }],
    queryFn: () => fetchReportedPosts({ minReports, search, limit: 200 }),
    staleTime: 30_000,
  });

  const remove = useMutation({
    mutationFn: deletePost,
    onSuccess: () => {
      show('削除しました', 'success');
      void qc.invalidateQueries({ queryKey: ['admin-reported'] });
      void qc.invalidateQueries({ queryKey: ['admin-stats'] });
    },
    onError: () => show('削除に失敗しました', 'error'),
  });

  return (
    <View>
      <SearchInput value={search} onChange={setSearch} placeholder="本文で検索…" />
      <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: SP['4'], paddingBottom: SP['2'] }}>
        <SortChip label="全部"     active={minReports === 1} onPress={() => setMinReports(1)} />
        <SortChip label="3件以上"  active={minReports === 3} onPress={() => setMinReports(3)} />
        <SortChip label="5件以上"  active={minReports === 5} onPress={() => setMinReports(5)} />
      </View>
      <View style={{ paddingHorizontal: SP['4'], gap: SP['2'] }}>
        {isLoading ? (
          <View style={{ padding: SP['8'], alignItems: 'center' }}><Spinner /></View>
        ) : error ? (
          <ErrorBlock message="通報を取得できませんでした" onRetry={() => void refetch()} />
        ) : (data ?? []).length === 0 ? (
          <EmptyBlock emoji="✨" label="通報されている投稿はありません" />
        ) : (
          (data ?? []).map((r) => (
            <ReportRow
              key={r.post_id}
              row={r}
              busy={remove.isPending && remove.variables === r.post_id}
              onView={() => router.push(`/admin/post/${r.post_id}` as never)}
              onViewAuthor={() => router.push(`/admin/user/${r.author_id}` as never)}
              onDelete={() => setPendingDelete(r)}
            />
          ))
        )}
      </View>
      <ConfirmDialog
        visible={pendingDelete !== null}
        title="投稿を削除"
        message={
          pendingDelete
            ? `この投稿を削除します。本人にも他の閲覧者にも表示されなくなります。\n\n通報: ${pendingDelete.reports_count} 件`
            : ''
        }
        confirmLabel="削除する"
        onConfirm={() => {
          if (pendingDelete) remove.mutate(pendingDelete.post_id);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
        destructive
      />
    </View>
  );
}

function ReportCountBadge({ count }: { count: number }) {
  const meta =
    count >= 5
      ? { fg: C.red, bg: C.redBg, border: C.red + '66' }
      : count >= 3
        ? { fg: C.amber, bg: C.amberBg, border: C.amber + '66' }
        : { fg: C.text2, bg: C.bg3, border: C.border };
  return (
    <View style={{
      minWidth: 40,
      paddingHorizontal: SP['2'], paddingVertical: 2,
      backgroundColor: meta.bg, borderRadius: R.md,
      borderWidth: 1, borderColor: meta.border,
      alignItems: 'center',
    }}>
      <Text style={{ fontSize: 13, fontWeight: '800', color: meta.fg, lineHeight: 15 }}>
        {count}
      </Text>
      <Text style={{ fontSize: 8, color: meta.fg, letterSpacing: 0.6, fontWeight: '700' }}>
        通報
      </Text>
    </View>
  );
}

function ReportRow({
  row, busy, onView, onViewAuthor, onDelete,
}: {
  row: AdminReportedPost;
  busy: boolean;
  onView: () => void;
  onViewAuthor: () => void;
  onDelete: () => void;
}) {
  const v = VISIBILITY_META[row.visibility] ?? { label: row.visibility, color: C.text3 };
  return (
    <View style={[{
      padding: SP['3'],
      backgroundColor: C.bg2,
      borderRadius: R.lg,
      borderWidth: 1,
      borderColor: C.border,
      gap: SP['2'],
    }, SHADOW.card]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: SP['3'] }}>
        <ReportCountBadge count={row.reports_count} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[T.body, { color: C.text, lineHeight: 21 }]} numberOfLines={3}>
            {previewText(row.content)}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'], flexWrap: 'wrap' }}>
            <Text style={[T.captionM, { color: C.accentLight }]} numberOfLines={1}>
              {row.author_nickname ?? '(unknown)'}
            </Text>
            <View style={{
              paddingHorizontal: SP['2'], paddingVertical: 1,
              backgroundColor: v.color + '22', borderRadius: R.sm,
              borderWidth: 1, borderColor: v.color + '55',
            }}>
              <Text style={{ fontSize: 9, color: v.color, fontWeight: '700' }}>{v.label}</Text>
            </View>
            <View style={{ flex: 1 }} />
            <Text style={[T.caption, { color: C.text4 }]}>{formatRelative(row.last_reported_at)}</Text>
          </View>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: SP['2'], justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <ActionButton label="作者を見る"  tone="neutral" onPress={onViewAuthor} />
        <ActionButton label="投稿詳細"    tone="accent"  onPress={onView} />
        <ActionButton label="削除"        tone="danger"  onPress={onDelete} busy={busy} />
      </View>
    </View>
  );
}

type ActionTone = 'neutral' | 'accent' | 'danger' | 'amber';
const ACTION_PALETTE: Record<ActionTone, KpiPalette> = {
  neutral: { fg: C.text,        bg: C.bg3,      border: C.border },
  accent:  { fg: C.accentLight, bg: C.accentBg, border: C.accent + '55' },
  danger:  { fg: C.red,         bg: C.redBg,    border: C.red + '55' },
  amber:   { fg: C.amber,       bg: C.amberBg,  border: C.amber + '55' },
};

function ActionButton({
  label, tone = 'neutral', onPress, busy,
}: {
  label: string;
  tone?: ActionTone;
  onPress: () => void;
  busy?: boolean;
}) {
  const p: KpiPalette = ACTION_PALETTE[tone];
  return (
    <PressableScale
      onPress={onPress}
      haptic={tone === 'danger' ? 'warn' : 'tap'}
      disabled={busy}
      style={{
        paddingHorizontal: SP['3'], paddingVertical: 7,
        backgroundColor: p.bg,
        borderRadius: R.full,
        borderWidth: 1,
        borderColor: p.border,
        flexDirection: 'row', alignItems: 'center', gap: 6,
        opacity: busy ? 0.6 : 1,
      }}
    >
      {busy && <ActivityIndicator size="small" color={p.fg} />}
      <Text style={[T.smallB, { color: p.fg, fontSize: 12 }]}>{label}</Text>
    </PressableScale>
  );
}

// ============================================================
// Tab 3 — ユーザー
// ============================================================
function UsersTab() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'recent' | 'concern' | 'trust' | 'problem'>('recent');
  const [pendingSuspend, setPendingSuspend] = useState<AdminUser | null>(null);
  const qc = useQueryClient();
  const show = useToastStore((s) => s.show);

  const isProblemMode = sortBy === 'problem';

  const usersQuery = useQuery({
    queryKey: ['admin-users', search],
    queryFn: () => fetchAllUsers({ search, limit: 200 }),
    staleTime: 30_000,
    enabled: !isProblemMode,
  });

  const problemQuery = useQuery({
    queryKey: ['admin-problem-users'],
    queryFn: () => fetchProblemUsers({ limit: 200, sortBy: 'concern' }),
    staleTime: 30_000,
    enabled: isProblemMode,
  });

  const list: AdminUser[] = useMemo(() => {
    if (isProblemMode) {
      const arr: AdminProblemUser[] = problemQuery.data ?? [];
      return arr.map<AdminUser>((u) => ({
        id: u.id,
        nickname: u.nickname,
        account_state: u.account_state,
        trust_score: u.trust_score,
        post_count: u.post_count,
        concern_received_count: u.concern_received_count,
        is_admin: false,
        created_at: u.created_at,
      }));
    }
    const arr = [...(usersQuery.data ?? [])];
    if (sortBy === 'concern') {
      arr.sort((a, b) => b.concern_received_count - a.concern_received_count);
    } else if (sortBy === 'trust') {
      arr.sort((a, b) => a.trust_score - b.trust_score);
    }
    return arr;
  }, [isProblemMode, problemQuery.data, usersQuery.data, sortBy]);

  const isLoading = isProblemMode ? problemQuery.isLoading : usersQuery.isLoading;
  const error = isProblemMode ? problemQuery.error : usersQuery.error;
  const refetch = isProblemMode ? problemQuery.refetch : usersQuery.refetch;

  const suspend = useMutation({
    mutationFn: suspendUser,
    onSuccess: () => {
      show('凍結しました', 'warn');
      void qc.invalidateQueries({ queryKey: ['admin-users'] });
      void qc.invalidateQueries({ queryKey: ['admin-problem-users'] });
      void qc.invalidateQueries({ queryKey: ['admin-stats'] });
    },
    onError: () => show('凍結に失敗しました', 'error'),
  });
  const unsuspend = useMutation({
    mutationFn: unsuspendUser,
    onSuccess: () => {
      show('解除しました', 'success');
      void qc.invalidateQueries({ queryKey: ['admin-users'] });
      void qc.invalidateQueries({ queryKey: ['admin-problem-users'] });
      void qc.invalidateQueries({ queryKey: ['admin-stats'] });
    },
    onError: () => show('解除に失敗しました', 'error'),
  });

  const onToggle = useCallback((u: AdminUser) => {
    if (u.account_state === 'suspended') {
      unsuspend.mutate(u.id);
    } else {
      setPendingSuspend(u);
    }
  }, [unsuspend]);

  return (
    <View>
      <SearchInput value={search} onChange={setSearch} placeholder="ニックネームで検索…" />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          flexDirection: 'row', gap: 6, paddingHorizontal: SP['4'], paddingBottom: SP['2'],
        }}
      >
        <SortChip label="最新"           active={sortBy === 'recent'}  onPress={() => setSortBy('recent')} />
        <SortChip label="信頼スコア低い順" active={sortBy === 'trust'}   onPress={() => setSortBy('trust')} />
        <SortChip label="通報多い順"     active={sortBy === 'concern'} onPress={() => setSortBy('concern')} />
        <SortChip label="問題ユーザー"   active={sortBy === 'problem'} onPress={() => setSortBy('problem')} />
      </ScrollView>
      <View style={{ paddingHorizontal: SP['4'], gap: SP['2'] }}>
        {isLoading ? (
          <View style={{ padding: SP['8'], alignItems: 'center' }}><Spinner /></View>
        ) : error ? (
          <ErrorBlock message="ユーザーを取得できませんでした" onRetry={() => void refetch()} />
        ) : list.length === 0 ? (
          <EmptyBlock emoji="📭" label="ユーザーがいません" />
        ) : (
          list.map((u) => (
            <UserRow
              key={u.id}
              user={u}
              busy={
                (suspend.isPending && suspend.variables === u.id) ||
                (unsuspend.isPending && unsuspend.variables === u.id)
              }
              onOpen={() => router.push(`/admin/user/${u.id}` as never)}
              onMessage={() => router.push(`/admin/message/${u.id}` as never)}
              onToggle={() => onToggle(u)}
            />
          ))
        )}
      </View>
      <ConfirmDialog
        visible={pendingSuspend !== null}
        title="ユーザーを凍結"
        message={`「${pendingSuspend?.nickname ?? pendingSuspend?.id ?? ''}」を凍結します。投稿や反応ができなくなります。`}
        confirmLabel="凍結する"
        onConfirm={() => {
          if (pendingSuspend) suspend.mutate(pendingSuspend.id);
          setPendingSuspend(null);
        }}
        onCancel={() => setPendingSuspend(null)}
        destructive
      />
    </View>
  );
}

function UserAvatar({ name }: { name: string }) {
  // deterministic accent based on first char
  const code = (name.charCodeAt(0) || 0) % 4;
  const colors: ReadonlyArray<readonly [string, string]> = [
    [C.accent, C.accentDeep],
    [C.pink, C.accent],
    [C.blue, C.accentDeep],
    [C.amber, C.red],
  ];
  const pair = colors[code] ?? colors[0]!;
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  return (
    <LinearGradient
      colors={pair as unknown as readonly [string, string, ...string[]]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        width: 40, height: 40, borderRadius: R.full,
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>{initial}</Text>
    </LinearGradient>
  );
}

function UserRow({
  user, busy, onOpen, onMessage, onToggle,
}: {
  user: AdminUser;
  busy: boolean;
  onOpen: () => void;
  onMessage: () => void;
  onToggle: () => void;
}) {
  const stateMeta = STATE_META[user.account_state] ?? { label: user.account_state, color: C.text3 };
  const isSuspended = user.account_state === 'suspended';
  const displayName = user.nickname ?? '(no nickname)';

  return (
    <View style={[{
      padding: SP['3'],
      backgroundColor: C.bg2,
      borderRadius: R.lg,
      borderWidth: 1,
      borderColor: C.border,
      gap: SP['2'],
    }, SHADOW.card]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['3'] }}>
        <UserAvatar name={displayName} />
        <View style={{ flex: 1, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'], flexWrap: 'wrap' }}>
            <Text style={[T.bodyB, { color: C.text, flexShrink: 1 }]} numberOfLines={1}>
              {displayName}
            </Text>
            {user.is_admin && (
              <View style={{
                paddingHorizontal: SP['2'], paddingVertical: 1,
                backgroundColor: C.accentBg, borderRadius: R.sm,
                borderWidth: 1, borderColor: C.accent + '55',
              }}>
                <Text style={{ fontSize: 9, color: C.accentLight, fontWeight: '700' }}>ADMIN</Text>
              </View>
            )}
            <View style={{
              paddingHorizontal: SP['2'], paddingVertical: 1,
              backgroundColor: stateMeta.color + '22', borderRadius: R.sm,
              borderWidth: 1, borderColor: stateMeta.color + '55',
            }}>
              <Text style={{ fontSize: 10, color: stateMeta.color, fontWeight: '700' }}>{stateMeta.label}</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: SP['4'], flexWrap: 'wrap' }}>
            <Stat label="投稿" value={String(user.post_count)} />
            <Stat label="信頼" value={String(user.trust_score)} />
            <Stat label="通報" value={String(user.concern_received_count)} accent={user.concern_received_count > 0 ? C.red : undefined} />
          </View>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: SP['2'], justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <ActionButton label="詳細" tone="neutral" onPress={onOpen} />
        <ActionButton label="DM"   tone="accent"  onPress={onMessage} />
        <ActionButton
          label={isSuspended ? '解除' : '凍結'}
          tone={isSuspended ? 'amber' : 'danger'}
          onPress={onToggle}
          busy={busy}
        />
      </View>
    </View>
  );
}

// ============================================================
// Tab 4 — 投稿
// ============================================================
function PostsTab() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'recent' | 'popular' | 'reports'>('recent');
  const [pendingDelete, setPendingDelete] = useState<AdminPost | null>(null);
  const qc = useQueryClient();
  const show = useToastStore((s) => s.show);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-posts', search],
    queryFn: () => fetchAllPosts({ search, limit: 200 }),
    staleTime: 30_000,
  });

  const sorted: AdminPost[] = useMemo(() => {
    const arr = [...(data ?? [])];
    if (sortBy === 'popular') {
      arr.sort((a, b) => b.likes_count - a.likes_count);
    } else if (sortBy === 'reports') {
      arr.sort((a, b) => b.concern_count - a.concern_count);
    }
    return arr;
  }, [data, sortBy]);

  const remove = useMutation({
    mutationFn: deletePost,
    onSuccess: () => {
      show('削除しました', 'success');
      void qc.invalidateQueries({ queryKey: ['admin-posts'] });
      void qc.invalidateQueries({ queryKey: ['admin-stats'] });
    },
    onError: () => show('削除に失敗しました', 'error'),
  });

  return (
    <View>
      <SearchInput value={search} onChange={setSearch} placeholder="本文で検索…" />
      <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: SP['4'], paddingBottom: SP['2'] }}>
        <SortChip label="最新" active={sortBy === 'recent'}  onPress={() => setSortBy('recent')} />
        <SortChip label="人気" active={sortBy === 'popular'} onPress={() => setSortBy('popular')} />
        <SortChip label="通報" active={sortBy === 'reports'} onPress={() => setSortBy('reports')} />
      </View>
      <View style={{ paddingHorizontal: SP['4'], gap: SP['2'] }}>
        {isLoading ? (
          <View style={{ padding: SP['8'], alignItems: 'center' }}><Spinner /></View>
        ) : error ? (
          <ErrorBlock message="投稿を取得できませんでした" onRetry={() => void refetch()} />
        ) : sorted.length === 0 ? (
          <EmptyBlock emoji="📭" label="投稿がありません" />
        ) : (
          sorted.map((p) => (
            <PostRow
              key={p.id}
              post={p}
              busy={remove.isPending && remove.variables === p.id}
              onOpen={() => router.push(`/admin/post/${p.id}` as never)}
              onDelete={() => setPendingDelete(p)}
            />
          ))
        )}
      </View>
      <ConfirmDialog
        visible={pendingDelete !== null}
        title="投稿を削除"
        message={`この投稿を削除します。本人にも他の閲覧者にも表示されなくなります。${pendingDelete?.concern_count ? `\n\n通報: ${pendingDelete.concern_count} 件` : ''}`}
        confirmLabel="削除する"
        onConfirm={() => {
          if (pendingDelete) remove.mutate(pendingDelete.id);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
        destructive
      />
    </View>
  );
}

function PostRow({
  post, busy, onOpen, onDelete,
}: {
  post: AdminPost;
  busy: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const vMeta = VISIBILITY_META[post.visibility] ?? { label: post.visibility, color: C.text3 };
  return (
    <View style={[{
      padding: SP['3'],
      backgroundColor: C.bg2,
      borderRadius: R.lg,
      borderWidth: 1,
      borderColor: C.border,
      gap: SP['2'],
    }, SHADOW.card]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'], flexWrap: 'wrap' }}>
        <View style={{
          paddingHorizontal: SP['2'], paddingVertical: 1,
          backgroundColor: vMeta.color + '22', borderRadius: R.sm,
          borderWidth: 1, borderColor: vMeta.color + '55',
        }}>
          <Text style={{ fontSize: 10, color: vMeta.color, fontWeight: '700' }}>{vMeta.label}</Text>
        </View>
        <Text style={[T.captionM, { color: C.text2 }]} numberOfLines={1}>
          {post.author_nickname ?? '(unknown)'}
        </Text>
        <View style={{ flex: 1 }} />
        <Text style={[T.caption, { color: C.text4 }]}>
          {formatRelative(post.created_at)}
        </Text>
      </View>

      <Text style={[T.body, { color: C.text, lineHeight: 21 }]} numberOfLines={4}>
        {post.content || '(本文なし)'}
      </Text>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['4'], flexWrap: 'wrap' }}>
        <Stat label="いいね" value={String(post.likes_count)} />
        <Stat label="通報"   value={String(post.concern_count)} accent={post.concern_count > 0 ? C.red : undefined} />
        <View style={{ flex: 1 }} />
        <ActionButton label="詳細" tone="accent"  onPress={onOpen} />
        <ActionButton label="削除" tone="danger" onPress={onDelete} busy={busy} />
      </View>
    </View>
  );
}

// ============================================================
// shared helpers
// ============================================================
function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <View style={{ paddingHorizontal: SP['4'], paddingTop: SP['3'], paddingBottom: SP['3'] }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: SP['2'],
        backgroundColor: C.bg2,
        borderRadius: R.full,
        borderWidth: 1,
        borderColor: C.border,
        paddingHorizontal: SP['3'],
      }}>
        <Icon.search size={16} color={C.text3} strokeWidth={2.2} />
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={C.text3}
          autoCapitalize="none"
          autoCorrect={false}
          style={[
            T.body,
            { color: C.text, flex: 1, paddingVertical: 10 },
          ]}
        />
        {value.length > 0 && (
          <PressableScale onPress={() => onChange('')} haptic="tap" hitSlop={10} style={{ padding: 4 }}>
            <Icon.close size={14} color={C.text3} strokeWidth={2.4} />
          </PressableScale>
        )}
      </View>
    </View>
  );
}

function SortChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <PressableScale
      onPress={onPress}
      haptic="select"
      hitSlop={10}
      style={{
        paddingHorizontal: SP['3'],
        paddingVertical: 6,
        backgroundColor: active ? C.accentBg : C.bg2,
        borderRadius: R.full,
        borderWidth: 1,
        borderColor: active ? C.accent + '66' : C.border,
      }}
    >
      <Text style={[T.caption, { color: active ? C.accentLight : C.text2, fontWeight: '700' }]}>{label}</Text>
    </PressableScale>
  );
}

// Stat / EmptyBlock / ErrorBlock は components/admin/AdminBlocks.tsx へ切り出し (Phase 8 split)

function previewText(s: string): string {
  if (!s) return '(本文なし)';
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length > 80 ? clean.slice(0, 80) + '…' : clean;
}
