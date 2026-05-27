// ============================================================
// AutomodRuleCard — admin/automod 画面の 1 ルール row
// ============================================================
// /admin/automod の一覧で使われる. 既存 admin 画面 (UsersTab / Reports row)
// と同じ視覚言語: bg2 + border + 軽い shadow + 右側 action pill。
// ============================================================

import { View, Text, ActivityIndicator, Platform } from 'react-native';
import { PressableScale } from '../ui/PressableScale';
import { Toggle } from '../ui/Toggle';
import { Icon } from '../../constants/icons';
import { C, R, SP, SHADOW } from '../../design/tokens';
import { T } from '../../design/typography';
import type { AutomodRuleRow } from '../../lib/api/automod';
import type { AutomodAction } from '../../lib/utils/automodMatcher';
import { formatRelative } from '../../lib/utils/date';

const isWeb = Platform.OS === 'web';

const ACTION_LABEL: Record<AutomodAction, string> = {
  hide:         '非表示',
  soft_warn:    'やんわり通知',
  collapse:     '折りたたみ',
  notify_admin: '管理者通知',
};

const ACTION_COLOR: Record<AutomodAction, string> = {
  hide:         C.red,
  soft_warn:    C.amber,
  collapse:     C.blue,
  notify_admin: C.accent,
};

export type AutomodRuleCardProps = {
  rule: AutomodRuleRow;
  todayMatches?: number;
  toggling?: boolean;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
};

export function AutomodRuleCard({
  rule,
  todayMatches,
  toggling,
  onToggle,
  onEdit,
  onDelete,
}: AutomodRuleCardProps) {
  const actionColor = ACTION_COLOR[rule.action];
  const actionLabel = ACTION_LABEL[rule.action];
  const isOff = !rule.enabled;

  return (
    <View
      style={[
        {
          padding: SP['3'],
          backgroundColor: C.bg2,
          borderRadius: R.lg,
          borderWidth: 1,
          borderColor: isOff ? C.border : actionColor + '44',
          borderLeftWidth: 3,
          borderLeftColor: isOff ? C.bg3 : actionColor,
          gap: SP['2'],
          opacity: isOff ? 0.75 : 1,
        },
        SHADOW.card,
      ]}
    >
      {/* ===== Header: name + action chip + toggle ===== */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[T.bodyMd, { color: C.text }]} numberOfLines={1}>
            {rule.name}
          </Text>
          {rule.description ? (
            <Text style={[T.caption, { color: C.text3 }]} numberOfLines={1}>
              {rule.description}
            </Text>
          ) : null}
        </View>
        <View
          style={{
            paddingHorizontal: SP['2'],
            paddingVertical: 3,
            backgroundColor: actionColor + '22',
            borderRadius: R.sm,
            borderWidth: 1,
            borderColor: actionColor + '55',
          }}
        >
          <Text style={{ fontSize: 10, color: actionColor, fontWeight: '800', letterSpacing: 0.4 }}>
            {actionLabel}
          </Text>
        </View>
        {toggling ? (
          <ActivityIndicator size="small" color={C.text2} />
        ) : (
          <Toggle value={rule.enabled} onChange={onToggle} />
        )}
      </View>

      {/* ===== Stats: 条件数 / 累計 / 24h / last_matched ===== */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['4'] }}>
        <StatPair label="条件" value={`${rule.conditions?.length ?? 0} 件`} />
        <StatPair
          label="累計マッチ"
          value={`${rule.match_count}`}
          accent={rule.match_count > 0 ? actionColor : undefined}
        />
        {typeof todayMatches === 'number' && (
          <StatPair
            label="直近 24h"
            value={`${todayMatches}`}
            accent={todayMatches > 0 ? C.amber : undefined}
          />
        )}
        {rule.last_matched_at && (
          <StatPair label="最終" value={formatRelative(rule.last_matched_at)} />
        )}
      </View>

      {/* ===== Action buttons ===== */}
      <View
        style={{
          flexDirection: 'row',
          gap: SP['2'],
          justifyContent: 'flex-end',
          flexWrap: 'wrap',
        }}
      >
        <ActionPill
          label="編集"
          tone="accent"
          icon={<Icon.edit size={12} color={C.accentLight} strokeWidth={2.4} />}
          onPress={onEdit}
        />
        <ActionPill
          label="削除"
          tone="danger"
          icon={<Icon.trash size={12} color={C.red} strokeWidth={2.4} />}
          onPress={onDelete}
        />
      </View>
    </View>
  );
}

function StatPair({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
      <Text style={[T.caption, { color: C.text3 }]}>{label}</Text>
      <Text style={[T.smallB, { color: accent ?? C.text, fontWeight: '700' }]}>{value}</Text>
    </View>
  );
}

type Tone = 'neutral' | 'accent' | 'danger';
const TONE: Record<Tone, { fg: string; bg: string; border: string }> = {
  neutral: { fg: C.text,        bg: C.bg3,      border: C.border },
  accent:  { fg: C.accentLight, bg: C.accentBg, border: C.accent + '55' },
  danger:  { fg: C.red,         bg: C.redBg,    border: C.red + '55' },
};

function ActionPill({
  label,
  tone,
  icon,
  onPress,
}: {
  label: string;
  tone: Tone;
  icon?: React.ReactNode;
  onPress: () => void;
}) {
  const p = TONE[tone];
  return (
    <PressableScale
      onPress={onPress}
      haptic={tone === 'danger' ? 'warn' : 'tap'}
      style={{
        paddingHorizontal: SP['3'],
        paddingVertical: 6,
        backgroundColor: p.bg,
        borderRadius: R.full,
        borderWidth: 1,
        borderColor: p.border,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        ...(isWeb ? ({ cursor: 'pointer' } as object) : null),
      }}
    >
      {icon}
      <Text style={[T.smallB, { color: p.fg, fontSize: 12 }]}>{label}</Text>
    </PressableScale>
  );
}
