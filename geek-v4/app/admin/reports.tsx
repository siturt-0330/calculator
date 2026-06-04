// ============================================================
// app/admin/reports.tsx — 通報キュー (report_cases ベース)
// ------------------------------------------------------------
// useReportQueue で通報ケースを優先度順に表示し、担当アサイン / 解決を行う。
// admin_notifications の realtime 購読で新着が即反映される (hook 側)。
//
// migration 0118 未適用環境では usedFallback=true になり、concern 集計ベースの
// 読み取り専用一覧に degrade する (assign/resolve は無効化 + 注記)。
// ============================================================
import { useState, useCallback } from 'react';
import { View, Text, ScrollView, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { Icon } from '../../constants/icons';
import { PressableScale } from '../../components/ui/PressableScale';
import { Spinner } from '../../components/ui/Spinner';
import { BackButton } from '../../components/nav/BackButton';
import { useToastStore } from '../../stores/toastStore';
import { formatRelative } from '../../lib/utils/date';
import { useReportQueue } from '../../hooks/useAdminReports';
import {
  assignReportCase,
  resolveReportCase,
  type ReportCase,
  type ReportCaseStatus,
  type ReportResolution,
} from '../../lib/api/adminReports';

const STATUS_TABS: { key: ReportCaseStatus | 'all'; label: string }[] = [
  { key: 'open', label: '未対応' },
  { key: 'triaged', label: '対応中' },
  { key: 'in_review', label: '審査中' },
  { key: 'resolved', label: '完了' },
  { key: 'all', label: 'すべて' },
];

const RESOLUTIONS: { key: ReportResolution; label: string }[] = [
  { key: 'content_removed', label: '削除対応' },
  { key: 'user_actioned', label: 'ユーザー措置' },
  { key: 'no_action', label: '問題なし' },
  { key: 'duplicate', label: '重複' },
];

function severityColor(sev: string): string {
  switch (sev) {
    case 'critical': return '#ef4444';
    case 'high': return '#f59e0b';
    case 'medium': return C.accentLight;
    default: return C.text3;
  }
}

function severityLabel(sev: string): string {
  switch (sev) {
    case 'critical': return '重大';
    case 'high': return '高';
    case 'medium': return '中';
    default: return '低';
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : '操作に失敗しました';
}

export default function AdminReportsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const show = useToastStore((s) => s.show);
  const [status, setStatus] = useState<ReportCaseStatus | 'all'>('open');
  const { cases, usedFallback, openCount, isLoading, isFetching, refetch } = useReportQueue(status);

  const invalidate = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['admin', 'report-queue'] });
  }, [qc]);

  const assignMut = useMutation({
    mutationFn: (caseId: string) => assignReportCase(caseId),
    onSuccess: () => { show('自分を担当にアサインしました', 'success'); invalidate(); },
    onError: (e) => show(errMsg(e), 'error'),
  });

  const resolveMut = useMutation({
    mutationFn: (v: { caseId: string; resolution: ReportResolution }) =>
      resolveReportCase(v.caseId, v.resolution),
    onSuccess: () => { show('対応を記録しました', 'success'); invalidate(); },
    onError: (e) => show(errMsg(e), 'error'),
  });

  const busy = assignMut.isPending || resolveMut.isPending;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* ヘッダー */}
      <View
        style={{
          paddingTop: insets.top + SP['2'],
          paddingBottom: SP['3'],
          paddingHorizontal: SP['4'],
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['3'],
          borderBottomWidth: 1,
          borderBottomColor: C.divider,
        }}
      >
        <BackButton />
        <Icon.flag size={20} color={C.accentLight} strokeWidth={2.2} />
        <Text style={[T.h3, { color: C.text, flex: 1 }]} numberOfLines={1}>通報キュー</Text>
        {openCount > 0 && (
          <View style={{ backgroundColor: '#ef4444', borderRadius: R.full, paddingHorizontal: SP['2'], paddingVertical: 2, minWidth: 22, alignItems: 'center' }}>
            <Text style={[T.captionM, { color: '#fff', fontWeight: '800' }]}>{openCount}</Text>
          </View>
        )}
      </View>

      {/* fallback 注記 */}
      {usedFallback && (
        <View style={{ marginHorizontal: SP['4'], marginTop: SP['3'], padding: SP['3'], backgroundColor: C.bg2, borderRadius: R.md, borderWidth: 1, borderColor: '#f59e0b55', flexDirection: 'row', gap: SP['2'], alignItems: 'center' }}>
          <Icon.warn size={16} color="#f59e0b" strokeWidth={2.2} />
          <Text style={[T.caption, { color: C.text2, flex: 1 }]}>
            通報ケースRPC(0118)が未適用のため、concern集計ベースの読み取り専用表示です。担当/解決は適用後に有効化されます。
          </Text>
        </View>
      )}

      {/* status フィルタ */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: SP['4'], paddingVertical: SP['3'], gap: SP['2'] }}
        style={{ flexGrow: 0 }}
      >
        {STATUS_TABS.map((tab) => {
          const active = status === tab.key;
          return (
            <PressableScale
              key={tab.key}
              onPress={() => setStatus(tab.key)}
              haptic="select"
              style={{
                paddingHorizontal: SP['3'],
                paddingVertical: SP['2'],
                borderRadius: R.full,
                backgroundColor: active ? C.text : C.bg2,
                borderWidth: 1,
                borderColor: active ? C.text : C.border,
              }}
            >
              <Text style={[T.caption, { color: active ? C.bg : C.text2, fontWeight: '700' }]}>{tab.label}</Text>
            </PressableScale>
          );
        })}
      </ScrollView>

      {/* リスト */}
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: SP['4'], paddingBottom: insets.bottom + SP['10'], gap: SP['3'] }}
        refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} tintColor={C.accent} />}
      >
        {isLoading ? (
          <View style={{ paddingVertical: SP['10'], alignItems: 'center' }}><Spinner size="large" /></View>
        ) : cases.length === 0 ? (
          <View style={{ paddingVertical: SP['10'], alignItems: 'center', gap: SP['2'] }}>
            <Icon.check size={32} color={C.text3} strokeWidth={1.8} />
            <Text style={[T.body, { color: C.text3 }]}>このステータスの通報はありません</Text>
          </View>
        ) : (
          cases.map((c) => (
            <CaseCard
              key={c.id}
              c={c}
              disabled={busy || usedFallback}
              onAssign={() => assignMut.mutate(c.id)}
              onResolve={(res) => resolveMut.mutate({ caseId: c.id, resolution: res })}
              onOpenPost={() => c.post && router.push(`/admin/post/${c.post.id}` as never)}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function CaseCard({
  c,
  disabled,
  onAssign,
  onResolve,
  onOpenPost,
}: {
  c: ReportCase;
  disabled: boolean;
  onAssign: () => void;
  onResolve: (res: ReportResolution) => void;
  onOpenPost: () => void;
}) {
  const sevColor = severityColor(c.severity);
  return (
    <View style={{ backgroundColor: C.bg2, borderRadius: R.lg, borderWidth: 1, borderColor: C.border, overflow: 'hidden' }}>
      {/* 上段: severity + 件数 + 時刻 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'], padding: SP['3'], borderBottomWidth: 1, borderBottomColor: C.divider }}>
        <View style={{ backgroundColor: sevColor + '22', borderRadius: R.sm, paddingHorizontal: SP['2'], paddingVertical: 2, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Icon.warn size={12} color={sevColor} strokeWidth={2.4} />
          <Text style={[T.caption, { color: sevColor, fontWeight: '800' }]}>{severityLabel(c.severity)}</Text>
        </View>
        <Text style={[T.captionM, { color: C.text2 }]}>通報 {c.report_count} 件</Text>
        <View style={{ flex: 1 }} />
        <Text style={[T.caption, { color: C.text3 }]}>{formatRelative(c.last_reported_at)}</Text>
      </View>

      {/* 投稿プレビュー (タップで詳細) */}
      <PressableScale onPress={onOpenPost} disabled={!c.post} style={{ padding: SP['3'], gap: SP['1'] }}>
        <Text style={[T.body, { color: C.text }]} numberOfLines={3}>
          {c.post?.content || '(投稿が見つかりません / 削除済み)'}
        </Text>
        {c.reasons.length > 0 && (
          <Text style={[T.caption, { color: C.text3 }]} numberOfLines={1}>理由: {c.reasons.join(', ')}</Text>
        )}
      </PressableScale>

      {/* アクション */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'], padding: SP['3'], borderTopWidth: 1, borderTopColor: C.divider }}>
        <PressableScale
          onPress={onAssign}
          disabled={disabled}
          haptic="tap"
          style={{ paddingHorizontal: SP['3'], paddingVertical: SP['2'], borderRadius: R.full, backgroundColor: C.bg3, opacity: disabled ? 0.4 : 1, flexDirection: 'row', alignItems: 'center', gap: 4 }}
        >
          <Icon.shield size={13} color={C.text2} strokeWidth={2.2} />
          <Text style={[T.caption, { color: C.text2, fontWeight: '700' }]}>担当</Text>
        </PressableScale>
        {RESOLUTIONS.map((r) => (
          <PressableScale
            key={r.key}
            onPress={() => onResolve(r.key)}
            disabled={disabled}
            haptic="select"
            style={{ paddingHorizontal: SP['3'], paddingVertical: SP['2'], borderRadius: R.full, backgroundColor: r.key === 'content_removed' || r.key === 'user_actioned' ? C.accent + '22' : C.bg3, opacity: disabled ? 0.4 : 1 }}
          >
            <Text style={[T.caption, { color: r.key === 'content_removed' || r.key === 'user_actioned' ? C.accentLight : C.text3, fontWeight: '700' }]}>{r.label}</Text>
          </PressableScale>
        ))}
      </View>
    </View>
  );
}
