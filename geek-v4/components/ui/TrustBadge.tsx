import { View, Text } from 'react-native';
import { Icon } from '@/constants/icons';

type Size = 'sm' | 'md';

// 信頼スコアを色と数値で表示する小さなバッジ
// 80+ green, 60+ blue, 40+ amber, それ未満 red
export function TrustBadge({ score, size = 'sm' }: { score: number | null | undefined; size?: Size }) {
  if (score === null || score === undefined) return null;
  const s = Math.max(0, Math.min(100, Math.round(score)));
  const tier = s >= 80 ? 'high' : s >= 60 ? 'good' : s >= 40 ? 'mid' : 'low';
  const palette: Record<typeof tier, { fg: string; bg: string; border: string }> = {
    high: { fg: '#22D3A4', bg: 'rgba(34,211,164,0.12)', border: 'rgba(34,211,164,0.45)' },
    good: { fg: '#7CB1FF', bg: 'rgba(124,177,255,0.12)', border: 'rgba(124,177,255,0.45)' },
    mid:  { fg: '#F5B342', bg: 'rgba(245,179,66,0.12)', border: 'rgba(245,179,66,0.45)' },
    low:  { fg: '#FF6B7A', bg: 'rgba(255,107,122,0.12)', border: 'rgba(255,107,122,0.45)' },
  };
  const c = palette[tier];
  const ShieldIcon = Icon.shield;
  const ph = size === 'md' ? 8 : 6;
  const pv = size === 'md' ? 3 : 2;
  const fs = size === 'md' ? 12 : 11;
  const icon = size === 'md' ? 12 : 10;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        paddingHorizontal: ph,
        paddingVertical: pv,
        backgroundColor: c.bg,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: c.border,
      }}
    >
      <ShieldIcon size={icon} color={c.fg} strokeWidth={2.4} />
      <Text style={{ fontSize: fs, fontWeight: '700', color: c.fg, lineHeight: fs + 2 }}>
        {s}
      </Text>
    </View>
  );
}
