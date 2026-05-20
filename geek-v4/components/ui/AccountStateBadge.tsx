import { View, Text } from 'react-native';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import type { AccountState } from '../../types/models';

const META: Record<AccountState, { emoji: string; label: string; desc: string; bg: string; fg: string }> = {
  healthy:    { emoji: '🟢', label: '健康',       desc: '通常通り利用できます',           bg: '#0d2a22', fg: '#22D3A4' },
  caution:    { emoji: '🟡', label: '注意',       desc: '気になる評価が増えています',     bg: '#2a1f0d', fg: '#F5A623' },
  restricted: { emoji: '🟠', label: '制限',       desc: '1日の投稿数が制限されています', bg: '#2a1f0d', fg: '#F5A623' },
  warned:     { emoji: '🔴', label: '警告',       desc: '一部機能が停止されています',     bg: '#2a1010', fg: '#E24B4A' },
  suspended:  { emoji: '⚫', label: '停止',       desc: '退会勧告中です',                 bg: '#1a1a1a', fg: '#71717a' },
};

export function AccountStateBadge({ state }: { state: AccountState }) {
  const m = META[state];
  return (
    <View style={{
      padding: SP['4'],
      backgroundColor: m.bg,
      borderRadius: R.lg,
      borderWidth: 1,
      borderColor: m.fg + '44',
      flexDirection: 'row',
      alignItems: 'center',
      gap: SP['3'],
    }}>
      <Text style={{ fontSize: 28 }}>{m.emoji}</Text>
      <View style={{ flex: 1 }}>
        <Text style={[T.h4, { color: m.fg }]}>アカウント状態：{m.label}</Text>
        <Text style={[T.small, { color: C.text2, marginTop: 2 }]}>{m.desc}</Text>
      </View>
    </View>
  );
}
