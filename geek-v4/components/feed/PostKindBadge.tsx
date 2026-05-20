import { View, Text } from 'react-native';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import type { PostKind } from '../../types/models';

const META: Record<PostKind, { label: string; emoji: string; bg: string; fg: string }> = {
  fact:    { label: '事実',     emoji: '📰', bg: '#0d1f3a', fg: '#3B82F6' },
  opinion: { label: '意見',     emoji: '💭', bg: '#2D2940', fg: '#9F96F9' },
  joke:    { label: 'ネタ',     emoji: '😂', bg: '#2a1f0d', fg: '#F5A623' },
  wip:     { label: '未完成',   emoji: '🚧', bg: '#0d2a22', fg: '#22D3A4' },
};

export function PostKindBadge({ kind, size = 'md' }: { kind: PostKind; size?: 'sm' | 'md' }) {
  const m = META[kind];
  const small = size === 'sm';
  return (
    <View style={{
      flexDirection: 'row',
      alignItems: 'center',
      gap: small ? 2 : SP['1'],
      paddingHorizontal: small ? SP['2'] : SP['2'],
      paddingVertical: small ? 1 : 2,
      borderRadius: R.sm,
      backgroundColor: m.bg,
      borderWidth: 1,
      borderColor: m.fg + '44',
    }}>
      <Text style={{ fontSize: small ? 10 : 12 }}>{m.emoji}</Text>
      <Text style={[small ? T.caption : T.smallM, { color: m.fg, fontWeight: '600' }]}>
        {m.label}
      </Text>
    </View>
  );
}

export const POST_KIND_META = META;
