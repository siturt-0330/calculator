import { useCallback, useEffect, useState } from 'react';
import { LayoutChangeEvent, ScrollView, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { PressableScale } from '../../components/ui/PressableScale';
import { Icon } from '../../constants/icons';
import { useAuthStore } from '../../stores/authStore';
import { fetchAdminDashboardStats } from '../../lib/api/adminExt';
import { C, R, SP, SHADOW } from '../../design/tokens';
import { T, FONT } from '../../design/typography';
import {
  type Tab,
  type KpiTone,
  type KpiPalette,
  KPI_PALETTE,
} from '../../components/admin/adminShared';
import { DashboardTab } from '../../components/admin/DashboardTab';
import { ReportsTab } from '../../components/admin/ReportsTab';
import { UsersTab } from '../../components/admin/UsersTab';
import { PostsTab } from '../../components/admin/PostsTab';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'dashboard', label: 'ダッシュボード' },
  { key: 'reports',   label: '通報' },
  { key: 'users',     label: 'ユーザー' },
  { key: 'posts',     label: '投稿' },
];

// ============================================================
// メイン screen
// ============================================================
//
// 抽出済み (Phase 8 split):
//   - DashboardTab / ReportsTab / UsersTab / PostsTab → components/admin/<Tab>.tsx
//   - 共通 meta + 小型 presentational + helpers → components/admin/adminShared.tsx
//   - Stat / EmptyBlock / ErrorBlock → components/admin/AdminBlocks.tsx
//
// この screen には残す:
//   - AdminIndexScreen (state + tab routing)
//   - KpiGrid + KpiCard (screen 直下の header)
//   - TabPills (Reanimated 駆動の sliding indicator)
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
// KPI 2x3 grid (screen 直下なのでここに残す)
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
