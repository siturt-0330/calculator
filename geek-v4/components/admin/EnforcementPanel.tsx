// ============================================================
// components/admin/EnforcementPanel.tsx — 段階的措置パネル (admin)
// ------------------------------------------------------------
// app/admin/user/[id].tsx に埋め込む独立コンポーネント。
// lib/api/enforcement.ts (migration 0122) を使い:
//   - 措置ボタン(警告/機能制限/一時停止/永久BAN) → applyEnforcement
//   - 有効strike数 + 措置履歴を表示
// 0122 未適用環境では fetch が throw するが、useQuery が握り(空表示)、
// applyMut のエラーはトーストで通知する(画面は壊れない)。
// ============================================================
import { View, Text } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';
import { useToastStore } from '../../stores/toastStore';
import { formatRelative } from '../../lib/utils/date';
import {
  applyEnforcement,
  fetchEnforcementHistory,
  fetchActiveStrikeCount,
  ENFORCEMENT_LABELS,
  type EnforcementLevel,
} from '../../lib/api/enforcement';

const LEVELS: { level: EnforcementLevel; color: string }[] = [
  { level: 0, color: '#f59e0b' }, // 警告
  { level: 1, color: '#f97316' }, // 機能制限
  { level: 2, color: '#ef4444' }, // 一時停止
  { level: 3, color: '#b91c1c' }, // 永久BAN
];

export function EnforcementPanel({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const show = useToastStore((s) => s.show);

  const historyQ = useQuery({
    queryKey: ['admin', 'enforcement', userId],
    queryFn: () => fetchEnforcementHistory(userId),
    staleTime: 30_000,
  });
  const strikeQ = useQuery({
    queryKey: ['admin', 'strike-count', userId],
    queryFn: () => fetchActiveStrikeCount(userId),
    staleTime: 30_000,
  });

  const applyMut = useMutation({
    mutationFn: (level: EnforcementLevel) =>
      applyEnforcement({ userId, level, reason: ENFORCEMENT_LABELS[level] }),
    onSuccess: () => {
      show('措置を適用しました', 'success');
      void qc.invalidateQueries({ queryKey: ['admin', 'enforcement', userId] });
      void qc.invalidateQueries({ queryKey: ['admin', 'strike-count', userId] });
    },
    onError: (e: unknown) =>
      show(e instanceof Error ? e.message : '措置の適用に失敗しました', 'error'),
  });

  const history = historyQ.data ?? [];
  const strikes = strikeQ.data ?? 0;

  return (
    <View style={{ gap: SP['3'] }}>
      {/* 有効 strike バッジ */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
        <Icon.warn size={16} color={strikes > 0 ? '#ef4444' : C.text3} strokeWidth={2.2} />
        <Text style={[T.captionM, { color: C.text2 }]}>
          有効 strike:{' '}
          <Text style={{ color: strikes > 0 ? '#ef4444' : C.text, fontWeight: '800' }}>{strikes}</Text> 件
          <Text style={[T.caption, { color: C.text3 }]}>（warning/機能制限は90日で失効）</Text>
        </Text>
      </View>

      {/* 措置ボタン */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
        {LEVELS.map(({ level, color }) => (
          <PressableScale
            key={level}
            onPress={() => applyMut.mutate(level)}
            disabled={applyMut.isPending}
            haptic={level >= 2 ? 'warn' : 'select'}
            accessibilityLabel={`${ENFORCEMENT_LABELS[level]} を適用`}
            style={{
              paddingHorizontal: SP['3'],
              paddingVertical: SP['2'],
              borderRadius: R.full,
              backgroundColor: color + '22',
              borderWidth: 1,
              borderColor: color + '55',
              opacity: applyMut.isPending ? 0.5 : 1,
            }}
          >
            <Text style={[T.caption, { color, fontWeight: '700' }]}>{ENFORCEMENT_LABELS[level]}</Text>
          </PressableScale>
        ))}
      </View>

      {/* 措置履歴 */}
      {history.length > 0 && (
        <View style={{ gap: 2 }}>
          <Text style={[T.caption, { color: C.text3, letterSpacing: 0.5 }]}>措置履歴</Text>
          {history.slice(0, 10).map((a) => {
            const lv = (a.level >= 0 && a.level <= 3 ? a.level : 0) as EnforcementLevel;
            const expired = a.expires_at !== null && new Date(a.expires_at).getTime() < Date.now();
            return (
              <View
                key={a.id}
                style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'], paddingVertical: 4 }}
              >
                <Text style={[T.caption, { color: C.text2, fontWeight: '700', minWidth: 64 }]}>
                  {ENFORCEMENT_LABELS[lv]}
                </Text>
                <Text style={[T.caption, { color: C.text3, flex: 1 }]} numberOfLines={1}>
                  {a.reason || a.scope}{expired ? '（失効）' : ''}
                </Text>
                <Text style={[T.caption, { color: C.text3 }]}>{formatRelative(a.issued_at)}</Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}
