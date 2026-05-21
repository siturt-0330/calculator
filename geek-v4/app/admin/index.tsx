import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { PressableScale } from '../../components/ui/PressableScale';
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
import { formatRelative } from '../../lib/utils/date';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';

type Tab = 'dashboard' | 'reports' | 'users' | 'posts';

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

const ACTION_META: Record<string, { label: string; color: string }> = {
  suspend_user:        { label: '凍結',         color: C.red },
  unsuspend_user:      { label: '凍結解除',     color: C.green },
  delete_post:         { label: '投稿削除',     color: C.red },
  delete_thread:       { label: 'スレ削除',     color: C.red },
  delete_comment:      { label: 'コメ削除',     color: C.red },
  send_message:        { label: 'DM 送信',      color: C.blue },
  reset_account_state: { label: 'state reset', color: C.amber },
  note:                { label: 'メモ',         color: C.text3 },
};

// ============================================================
// メイン screen
// ============================================================
export default function AdminIndexScreen() {
  const insets = useSafeAreaInsets();
  const signOut = useAuthStore((s) => s.signOut);
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('dashboard');

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
        title="管理パネル"
        left={<BackButton />}
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
            <PressableScale
              onPress={reloadAll}
              haptic="tap"
              hitSlop={10}
              style={{
                width: 32, height: 32, borderRadius: R.full,
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
                paddingHorizontal: SP['3'], paddingVertical: 6,
                backgroundColor: C.bg3, borderRadius: R.full,
                borderWidth: 1, borderColor: C.border,
              }}
            >
              <Text style={[T.caption, { color: C.text2, fontWeight: '700' }]}>ログアウト</Text>
            </PressableScale>
          </View>
        }
      />

      {/* DEV badge */}
      <View style={{
        paddingHorizontal: SP['4'], paddingTop: SP['2'], paddingBottom: SP['1'],
        flexDirection: 'row', alignItems: 'center', gap: SP['2'],
      }}>
        <View style={{
          paddingHorizontal: SP['2'], paddingVertical: 2,
          backgroundColor: C.redBg, borderRadius: R.sm,
          borderWidth: 1, borderColor: C.red + '55',
        }}>
          <Text style={{ fontSize: 10, color: C.red, fontWeight: '700', letterSpacing: 0.5 }}>DEV ADMIN</Text>
        </View>
        <Text style={[T.caption, { color: C.text3 }]}>
          全ユーザー / 投稿への書き込み権限あり。慎重に。
        </Text>
      </View>

      {/* KPI ストリップ — 常時表示 */}
      <KpiStrip />

      {/* タブ */}
      <View style={{
        flexDirection: 'row',
        paddingHorizontal: SP['4'],
        paddingTop: SP['3'],
        gap: SP['4'],
        borderBottomWidth: 1,
        borderBottomColor: C.border,
      }}>
        <TabUnderline active={tab === 'dashboard'} label="ダッシュボード" onPress={() => setTab('dashboard')} />
        <TabUnderline active={tab === 'reports'}   label="通報"           onPress={() => setTab('reports')} />
        <TabUnderline active={tab === 'users'}     label="ユーザー"       onPress={() => setTab('users')} />
        <TabUnderline active={tab === 'posts'}     label="投稿"           onPress={() => setTab('posts')} />
      </View>

      <View style={{ flex: 1, paddingTop: SP['3'] }}>
        {tab === 'dashboard' ? (
          <DashboardTab bottomInset={insets.bottom} onJumpReports={() => setTab('reports')} />
        ) : tab === 'reports' ? (
          <ReportsTab bottomInset={insets.bottom} />
        ) : tab === 'users' ? (
          <UsersTab bottomInset={insets.bottom} />
        ) : (
          <PostsTab bottomInset={insets.bottom} />
        )}
      </View>
    </View>
  );
}

// ============================================================
// 共通 — KPI / Tab underline / SectionHeader
// ============================================================
function KpiStrip() {
  const { data } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: fetchAdminDashboardStats,
    staleTime: 30_000,
  });

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{
        paddingHorizontal: SP['4'],
        paddingTop: SP['2'],
        gap: SP['2'],
      }}
    >
      <KpiCard label="ユーザー"     value={data?.totalUsers}     tone="neutral" compact />
      <KpiCard label="投稿"         value={data?.totalPosts}     tone="neutral" compact />
      <KpiCard label="24h アクティブ" value={data?.activeUsers24h} tone="accent"  compact />
      <KpiCard label="未対応通報"   value={data?.openReports}    tone="red"     compact />
    </ScrollView>
  );
}

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

function KpiCard({
  label, value, tone = 'neutral', compact = false,
}: {
  label: string;
  value: number | undefined;
  tone?: KpiTone;
  compact?: boolean;
}) {
  const p: KpiPalette = KPI_PALETTE[tone];
  const showValue = value !== undefined ? value.toLocaleString('ja-JP') : '—';
  return (
    <View
      style={{
        minWidth: compact ? 96 : 140,
        paddingHorizontal: SP['3'],
        paddingVertical: compact ? SP['2'] : SP['3'],
        backgroundColor: p.bg,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: p.border,
        gap: 2,
      }}
    >
      <Text
        style={{
          fontSize: compact ? 20 : 28,
          lineHeight: compact ? 24 : 32,
          color: p.fg,
          fontWeight: '700',
          letterSpacing: -0.4,
        }}
        numberOfLines={1}
      >
        {showValue}
      </Text>
      <Text style={{ fontSize: 11, color: C.text3, fontWeight: '600' }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function TabUnderline({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      style={{
        paddingVertical: SP['2'],
        borderBottomWidth: 2,
        borderBottomColor: active ? C.accent : 'transparent',
        marginBottom: -1,
      }}
    >
      <Text style={[T.smallB, { color: active ? C.text : C.text3 }]}>{label}</Text>
    </PressableScale>
  );
}

function SectionHeader({ label, right }: { label: string; right?: React.ReactNode }) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: SP['2'],
      paddingHorizontal: SP['4'], paddingBottom: SP['2'], paddingTop: SP['3'],
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
// Tab 1 — ダッシュボード
// ============================================================
function DashboardTab({ bottomInset, onJumpReports }: { bottomInset: number; onJumpReports: () => void }) {
  const router = useRouter();
  const { data: stats } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: fetchAdminDashboardStats,
    staleTime: 30_000,
  });
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

  return (
    <ScrollView
      contentContainerStyle={{
        paddingBottom: bottomInset + SP['10'],
      }}
    >
      {/* 6 big KPI cards (2x3 grid) */}
      <SectionHeader label="OVERVIEW" />
      <View style={{
        paddingHorizontal: SP['4'],
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: SP['2'],
      }}>
        <KpiBig label="全ユーザー"        value={stats?.totalUsers}     tone="neutral" />
        <KpiBig label="全投稿"            value={stats?.totalPosts}     tone="neutral" />
        <KpiBig label="24h アクティブ"    value={stats?.activeUsers24h} tone="accent" />
        <KpiBig label="今日の新規投稿"    value={stats?.newPostsToday}  tone="blue" />
        <KpiBig label="凍結ユーザー"      value={stats?.suspendedUsers} tone="amber" />
        <KpiBig label="未対応通報"        value={stats?.openReports}    tone="red" />
      </View>

      {/* Top reported */}
      <SectionHeader
        label="TOP REPORTED"
        right={
          <PressableScale onPress={onJumpReports} haptic="tap" hitSlop={6}>
            <Text style={[T.caption, { color: C.accentLight, fontWeight: '700' }]}>詳細を見る →</Text>
          </PressableScale>
        }
      />
      <View style={{ paddingHorizontal: SP['4'], gap: SP['2'] }}>
        {topReports === undefined ? (
          <View style={{ paddingVertical: SP['6'], alignItems: 'center' }}><Spinner /></View>
        ) : topReports.length === 0 ? (
          <Text style={[T.small, { color: C.text3, paddingVertical: SP['4'] }]}>通報されている投稿はありません</Text>
        ) : (
          topReports.map((r) => (
            <PressableScale
              key={r.post_id}
              onPress={() => router.push(`/admin/post/${r.post_id}` as never)}
              haptic="tap"
              style={{
                padding: SP['3'],
                backgroundColor: C.bg2,
                borderRadius: R.lg,
                borderWidth: 1,
                borderColor: C.border,
                gap: 6,
              }}
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
      <SectionHeader label="RECENT ACTIVITY" />
      <View style={{ paddingHorizontal: SP['4'], gap: 4 }}>
        {log === undefined ? (
          <View style={{ paddingVertical: SP['6'], alignItems: 'center' }}><Spinner /></View>
        ) : log.length === 0 ? (
          <Text style={[T.small, { color: C.text3, paddingVertical: SP['4'] }]}>履歴はまだありません</Text>
        ) : (
          log.map((e) => <ActivityRow key={e.id} entry={e} />)
        )}
      </View>
    </ScrollView>
  );
}

function KpiBig({
  label, value, tone = 'neutral',
}: {
  label: string;
  value: number | undefined;
  tone?: KpiTone;
}) {
  // 2 列固定 — flexBasis 48% で割る
  const p: KpiPalette = KPI_PALETTE[tone];
  const showValue = value !== undefined ? value.toLocaleString('ja-JP') : '—';
  return (
    <View
      style={{
        flexBasis: '48%',
        flexGrow: 1,
        padding: SP['3'],
        backgroundColor: p.bg,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: p.border,
        gap: 4,
      }}
    >
      <Text style={{ fontSize: 28, lineHeight: 32, color: p.fg, fontWeight: '700', letterSpacing: -0.4 }}>
        {showValue}
      </Text>
      <Text style={{ fontSize: 11, color: C.text3, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

function ActivityRow({ entry }: { entry: AdminModerationLogEntry }) {
  const meta = ACTION_META[entry.action] ?? { label: entry.action, color: C.text3 };
  return (
    <View style={{
      paddingHorizontal: SP['3'], paddingVertical: SP['2'],
      flexDirection: 'row', alignItems: 'center', gap: SP['2'],
      borderBottomWidth: 1, borderBottomColor: C.divider,
    }}>
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
// Tab 2 — 通報 (NEW)
// ============================================================
function ReportsTab({ bottomInset }: { bottomInset: number }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [minReports, setMinReports] = useState<1 | 3 | 5>(1);
  const [pendingDelete, setPendingDelete] = useState<AdminReportedPost | null>(null);
  const qc = useQueryClient();
  const { show } = useToastStore();

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
    <View style={{ flex: 1 }}>
      <SearchInput value={search} onChange={setSearch} placeholder="本文で検索…" />
      <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: SP['4'], paddingBottom: SP['2'] }}>
        <SortChip label="すべて"   active={minReports === 1} onPress={() => setMinReports(1)} />
        <SortChip label="3件以上" active={minReports === 3} onPress={() => setMinReports(3)} />
        <SortChip label="5件以上" active={minReports === 5} onPress={() => setMinReports(5)} />
      </View>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: SP['4'],
          paddingBottom: bottomInset + SP['10'],
          gap: SP['2'],
        }}
      >
        {isLoading ? (
          <View style={{ padding: SP['8'], alignItems: 'center' }}><Spinner /></View>
        ) : error ? (
          <ErrorBlock message="通報を取得できませんでした" onRetry={() => void refetch()} />
        ) : (data ?? []).length === 0 ? (
          <EmptyBlock label="該当する通報はありません" />
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
      </ScrollView>
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
      minWidth: 38,
      paddingHorizontal: SP['2'], paddingVertical: 2,
      backgroundColor: meta.bg, borderRadius: R.sm,
      borderWidth: 1, borderColor: meta.border,
      alignItems: 'center',
    }}>
      <Text style={{ fontSize: 12, fontWeight: '800', color: meta.fg }}>
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
    <View style={{
      padding: SP['3'],
      backgroundColor: C.bg2,
      borderRadius: R.lg,
      borderWidth: 1,
      borderColor: C.border,
      gap: SP['2'],
    }}>
      {/* 1 行目: badge + visibility + last reported */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
        <ReportCountBadge count={row.reports_count} />
        <View style={{
          paddingHorizontal: SP['2'], paddingVertical: 1,
          backgroundColor: v.color + '22', borderRadius: R.sm,
          borderWidth: 1, borderColor: v.color + '55',
        }}>
          <Text style={{ fontSize: 10, color: v.color, fontWeight: '700' }}>{v.label}</Text>
        </View>
        <View style={{ flex: 1 }} />
        <Text style={[T.caption, { color: C.text4 }]}>{formatRelative(row.last_reported_at)}</Text>
      </View>

      {/* 2 行目: author (tap to author) */}
      <PressableScale onPress={onViewAuthor} haptic="tap" hitSlop={6}>
        <Text style={[T.captionM, { color: C.accentLight }]} numberOfLines={1}>
          {row.author_nickname ?? '(unknown)'} の投稿 →
        </Text>
      </PressableScale>

      {/* 3 行目: content preview */}
      <Text style={[T.body, { color: C.text, lineHeight: 21 }]} numberOfLines={3}>
        {previewText(row.content)}
      </Text>

      {/* 4 行目: actions */}
      <View style={{ flexDirection: 'row', gap: SP['2'], justifyContent: 'flex-end' }}>
        <ActionButton label="作者を見る" tone="neutral" onPress={onViewAuthor} />
        <ActionButton label="投稿を見る" tone="accent"  onPress={onView} />
        <ActionButton label="削除"       tone="danger"  onPress={onDelete} busy={busy} />
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
        paddingHorizontal: SP['3'], paddingVertical: 6,
        backgroundColor: p.bg,
        borderRadius: R.full,
        borderWidth: 1,
        borderColor: p.border,
        flexDirection: 'row', alignItems: 'center', gap: 6,
        opacity: busy ? 0.6 : 1,
      }}
    >
      {busy && <ActivityIndicator size="small" color={p.fg} />}
      <Text style={[T.smallB, { color: p.fg }]}>{label}</Text>
    </PressableScale>
  );
}

// ============================================================
// Tab 3 — ユーザー
// ============================================================
function UsersTab({ bottomInset }: { bottomInset: number }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'recent' | 'concern' | 'trust' | 'problem'>('recent');
  const [pendingSuspend, setPendingSuspend] = useState<AdminUser | null>(null);
  const qc = useQueryClient();
  const { show } = useToastStore();

  const isProblemMode = sortBy === 'problem';

  // 通常モード — 全ユーザー
  const usersQuery = useQuery({
    queryKey: ['admin-users', search],
    queryFn: () => fetchAllUsers({ search, limit: 200 }),
    staleTime: 30_000,
    enabled: !isProblemMode,
  });

  // 問題ユーザーモード — 別 view
  const problemQuery = useQuery({
    queryKey: ['admin-problem-users'],
    queryFn: () => fetchProblemUsers({ limit: 200, sortBy: 'concern' }),
    staleTime: 30_000,
    enabled: isProblemMode,
  });

  // 共通 AdminUser 型に normalize
  const list: AdminUser[] = useMemo(() => {
    if (isProblemMode) {
      const arr = problemQuery.data ?? [];
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
    <View style={{ flex: 1 }}>
      <SearchInput value={search} onChange={setSearch} placeholder="ニックネームで検索…" />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          flexDirection: 'row', gap: 6, paddingHorizontal: SP['4'], paddingBottom: SP['2'],
        }}
      >
        <SortChip label="最新"           active={sortBy === 'recent'}  onPress={() => setSortBy('recent')} />
        <SortChip label="通報多い順"     active={sortBy === 'concern'} onPress={() => setSortBy('concern')} />
        <SortChip label="信頼低い順"     active={sortBy === 'trust'}   onPress={() => setSortBy('trust')} />
        <SortChip label="問題ユーザー"   active={sortBy === 'problem'} onPress={() => setSortBy('problem')} />
      </ScrollView>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: SP['4'],
          paddingBottom: bottomInset + SP['10'],
          gap: SP['2'],
        }}
      >
        {isLoading ? (
          <View style={{ padding: SP['8'], alignItems: 'center' }}><Spinner /></View>
        ) : error ? (
          <ErrorBlock message="ユーザーを取得できませんでした" onRetry={() => void refetch()} />
        ) : list.length === 0 ? (
          <EmptyBlock label="該当するユーザーはありません" />
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
      </ScrollView>
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

  return (
    <PressableScale
      onPress={onOpen}
      haptic="tap"
      style={{
        padding: SP['3'],
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
        gap: SP['2'],
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'], flexWrap: 'wrap' }}>
        <Text style={[T.bodyB, { color: C.text, flexShrink: 1 }]} numberOfLines={1}>
          {user.nickname ?? '(no nickname)'}
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

      <Text style={[T.mono, { color: C.text4, fontSize: 10 }]} numberOfLines={1}>
        {user.id}
      </Text>

      <View style={{ flexDirection: 'row', gap: SP['4'], flexWrap: 'wrap' }}>
        <Stat label="信頼" value={String(user.trust_score)} />
        <Stat label="投稿" value={String(user.post_count)} />
        <Stat label="通報" value={String(user.concern_received_count)} accent={user.concern_received_count > 0 ? C.red : undefined} />
      </View>

      <View style={{ flexDirection: 'row', gap: SP['2'], justifyContent: 'flex-end' }}>
        <ActionButton label="DM" tone="accent" onPress={onMessage} />
        <ActionButton
          label={isSuspended ? '解除' : '凍結'}
          tone={isSuspended ? 'amber' : 'danger'}
          onPress={onToggle}
          busy={busy}
        />
      </View>
    </PressableScale>
  );
}

// ============================================================
// Tab 4 — 投稿 (既存ロジック)
// ============================================================
function PostsTab({ bottomInset }: { bottomInset: number }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [pendingDelete, setPendingDelete] = useState<AdminPost | null>(null);
  const qc = useQueryClient();
  const { show } = useToastStore();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-posts', search],
    queryFn: () => fetchAllPosts({ search, limit: 200 }),
    staleTime: 30_000,
  });

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
    <View style={{ flex: 1 }}>
      <SearchInput value={search} onChange={setSearch} placeholder="本文で検索…" />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: SP['4'],
          paddingBottom: bottomInset + SP['10'],
          gap: SP['2'],
        }}
      >
        {isLoading ? (
          <View style={{ padding: SP['8'], alignItems: 'center' }}><Spinner /></View>
        ) : error ? (
          <ErrorBlock message="投稿を取得できませんでした" onRetry={() => void refetch()} />
        ) : (data ?? []).length === 0 ? (
          <EmptyBlock label="該当する投稿はありません" />
        ) : (
          (data ?? []).map((p) => (
            <PostRow
              key={p.id}
              post={p}
              busy={remove.isPending && remove.variables === p.id}
              onOpen={() => router.push(`/admin/post/${p.id}` as never)}
              onDelete={() => setPendingDelete(p)}
            />
          ))
        )}
      </ScrollView>
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
    <PressableScale
      onPress={onOpen}
      haptic="tap"
      style={{
        padding: SP['3'],
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
        gap: SP['2'],
      }}
    >
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
          {new Date(post.created_at).toLocaleDateString('ja-JP')}
        </Text>
      </View>

      <Text style={[T.body, { color: C.text, lineHeight: 21 }]} numberOfLines={4}>
        {post.content || '(本文なし)'}
      </Text>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['4'], flexWrap: 'wrap' }}>
        <Stat label="いいね" value={String(post.likes_count)} />
        <Stat label="通報" value={String(post.concern_count)} accent={post.concern_count > 0 ? C.red : undefined} />
        <View style={{ flex: 1 }} />
        <ActionButton label="削除" tone="danger" onPress={onDelete} busy={busy} />
      </View>

      <Text style={[T.mono, { color: C.text4, fontSize: 10 }]} numberOfLines={1}>
        {post.id}
      </Text>
    </PressableScale>
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
        backgroundColor: C.bg3,
        borderRadius: R.md,
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
            { color: C.text, flex: 1, paddingVertical: SP['3'] },
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
        paddingVertical: 4,
        backgroundColor: active ? C.accentBg : C.bg3,
        borderRadius: R.full,
        borderWidth: 1,
        borderColor: active ? C.accent + '55' : C.border,
      }}
    >
      <Text style={[T.caption, { color: active ? C.accentLight : C.text2, fontWeight: '700' }]}>{label}</Text>
    </PressableScale>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
      <Text style={[T.caption, { color: C.text3 }]}>{label}</Text>
      <Text style={[T.smallB, { color: accent ?? C.text, fontWeight: '700' }]}>{value}</Text>
    </View>
  );
}

function EmptyBlock({ label }: { label: string }) {
  return (
    <View style={{ padding: SP['8'], alignItems: 'center', gap: SP['2'] }}>
      <Text style={{ fontSize: 36 }}>📭</Text>
      <Text style={[T.body, { color: C.text2 }]}>{label}</Text>
    </View>
  );
}

function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={{ padding: SP['8'], alignItems: 'center', gap: SP['3'] }}>
      <Text style={{ fontSize: 36 }}>⚠️</Text>
      <Text style={[T.body, { color: C.text2, textAlign: 'center' }]}>{message}</Text>
      <PressableScale
        onPress={onRetry}
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
  );
}

function previewText(s: string): string {
  if (!s) return '(本文なし)';
  // 80 文字 + ellipsis。改行はスペースに潰してレイアウト安定。
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length > 80 ? clean.slice(0, 80) + '…' : clean;
}
