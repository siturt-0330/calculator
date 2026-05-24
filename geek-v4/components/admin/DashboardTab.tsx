// ============================================================
// DashboardTab — admin/index.tsx の Tab 1 (ダッシュボード)
// ============================================================
// Hero (health 状態) + 公式申請カード + 広告管理ナビ + Top Reported + Recent Activity。
// stats は親で fetch して props 経由。重い query (log/topReports/pendingApps) は
// この tab を開いている時だけ走るように tab 内で useQuery する。
// ============================================================
import { Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { PressableScale } from '../ui/PressableScale';
import { Spinner } from '../ui/Spinner';
import { Icon } from '../../constants/icons';
import { C, R, SP, SHADOW } from '../../design/tokens';
import { T, FONT } from '../../design/typography';
import { formatRelative } from '../../lib/utils/date';
import {
  fetchModerationLog,
  fetchReportedPosts,
} from '../../lib/api/adminExt';
import { fetchPendingOfficialApps } from '../../lib/api/officialCommunities';
import {
  SectionHeader,
  ActivityRow,
  ReportCountBadge,
  computeHealth,
  previewText,
} from './adminShared';

type Stats = {
  totalUsers: number;
  totalPosts: number;
  activeUsers24h: number;
  newPostsToday: number;
  suspendedUsers: number;
  openReports: number;
};

export function DashboardTab({ stats, onJumpReports }: { stats: Stats | undefined; onJumpReports: () => void }) {
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
