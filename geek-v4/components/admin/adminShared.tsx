// ============================================================
// adminShared — admin/index.tsx の 4 タブ共通で使う部品
// ============================================================
// app/admin/index.tsx (1344 行) から sub-component を分離する過程で抽出。
//
// - Tab 型 / 各種 meta 定数 (state/visibility/action/kpi/action button)
// - 小型 presentational (SearchInput, SortChip, SectionHeader, ActivityRow,
//   ReportCountBadge, ActionButton, UserAvatar)
// - pure helpers (computeHealth, previewText)
//
// ここに集約することで <Tab>.tsx 同士の循環 import を避ける。
// ============================================================
import { ActivityIndicator, Text, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { formatRelative } from '../../lib/utils/date';
import type { AdminModerationLogEntry } from '../../lib/api/adminExt';

// ============================================================
// types
// ============================================================
export type Tab = 'dashboard' | 'reports' | 'users' | 'posts';

export type KpiTone = 'neutral' | 'accent' | 'red' | 'amber' | 'green' | 'blue';
export type KpiPalette = { fg: string; bg: string; border: string };

export type HealthLevel = 'healthy' | 'caution' | 'critical';

export type ActionTone = 'neutral' | 'accent' | 'danger' | 'amber';

// ============================================================
// meta 定数
// ============================================================
export const STATE_META: Record<string, { label: string; color: string }> = {
  healthy:    { label: '健康',  color: C.green },
  caution:    { label: '注意',  color: C.amber },
  restricted: { label: '制限',  color: C.amber },
  warned:     { label: '警告',  color: C.red },
  suspended:  { label: '停止',  color: C.text3 },
};

export const VISIBILITY_META: Record<string, { label: string; color: string }> = {
  public:           { label: '公開',         color: C.green },
  community_public: { label: 'コミュ+公開', color: C.blue },
  community_only:   { label: 'コミュ限定',   color: C.accent },
  private:          { label: '非公開',       color: C.text3 },
};

export const ACTION_META: Record<string, { label: string; color: string; emoji: string }> = {
  suspend_user:        { label: '凍結',         color: C.red,    emoji: '🔒' },
  unsuspend_user:      { label: '凍結解除',     color: C.green,  emoji: '🔓' },
  delete_post:         { label: '投稿削除',     color: C.red,    emoji: '🗑️' },
  delete_thread:       { label: 'スレ削除',     color: C.red,    emoji: '🗑️' },
  delete_comment:      { label: 'コメ削除',     color: C.red,    emoji: '🗑️' },
  send_message:        { label: 'DM 送信',      color: C.blue,   emoji: '✉️' },
  reset_account_state: { label: 'state reset', color: C.amber,  emoji: '♻️' },
  note:                { label: 'メモ',         color: C.text3,  emoji: '📝' },
};

export const KPI_PALETTE: Record<KpiTone, KpiPalette> = {
  neutral: { fg: C.text,        bg: C.bg2,      border: C.border },
  accent:  { fg: C.accentLight, bg: C.accentBg, border: C.accent + '55' },
  red:     { fg: C.red,         bg: C.redBg,    border: C.red + '55' },
  amber:   { fg: C.amber,       bg: C.amberBg,  border: C.amber + '55' },
  green:   { fg: C.green,       bg: C.greenBg,  border: C.green + '55' },
  blue:    { fg: C.blue,        bg: C.blueBg,   border: C.blue + '55' },
};

export const ACTION_PALETTE: Record<ActionTone, KpiPalette> = {
  neutral: { fg: C.text,        bg: C.bg3,      border: C.border },
  accent:  { fg: C.accentLight, bg: C.accentBg, border: C.accent + '55' },
  danger:  { fg: C.red,         bg: C.redBg,    border: C.red + '55' },
  amber:   { fg: C.amber,       bg: C.amberBg,  border: C.amber + '55' },
};

// ============================================================
// pure helpers
// ============================================================
export function previewText(s: string): string {
  if (!s) return '(本文なし)';
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length > 80 ? clean.slice(0, 80) + '…' : clean;
}

export function computeHealth(stats: { totalUsers: number; suspendedUsers: number; openReports: number } | undefined): {
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

// ============================================================
// presentational (small)
// ============================================================
export function SectionHeader({ label, right }: { label: string; right?: React.ReactNode }) {
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

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
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

export function SortChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
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

export function ActivityRow({ entry, last }: { entry: AdminModerationLogEntry; last: boolean }) {
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

export function ReportCountBadge({ count }: { count: number }) {
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

export function ActionButton({
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

export function UserAvatar({ name }: { name: string }) {
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
