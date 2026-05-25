import { View, Text } from 'react-native';
import { Icon } from '../../constants/icons';

type Size = 'sm' | 'md';

// 信頼スコアを色と数値で表示する小さなバッジ
// しきい値は lib/trust/score.ts の TIERS と合わせる:
//   100  → god       (神 / 紫)
//   90+  → definitely (絶対良い人 / amber)
//   70+  → probably   (多分良い人 / green)
//   30+  → regular    (常連 / blue)
//   0+   → newcomer   (新参者 / 灰)
export function TrustBadge({ score, size = 'sm' }: { score: number | null | undefined; size?: Size }) {
  if (score === null || score === undefined) return null;
  const s = Math.max(0, Math.min(100, Math.round(score)));
  const tier: 'god' | 'definitely' | 'probably' | 'regular' | 'newcomer' =
    s >= 100 ? 'god' :
    s >= 90  ? 'definitely' :
    s >= 70  ? 'probably' :
    s >= 30  ? 'regular' :
               'newcomer';
  const palette: Record<typeof tier, { fg: string; bg: string; border: string }> = {
    god:        { fg: '#a855f7', bg: 'rgba(168,85,247,0.14)', border: 'rgba(168,85,247,0.55)' },
    definitely: { fg: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.45)' },
    probably:   { fg: '#34d399', bg: 'rgba(52,211,153,0.12)', border: 'rgba(52,211,153,0.45)' },
    regular:    { fg: '#60a5fa', bg: 'rgba(96,165,250,0.12)', border: 'rgba(96,165,250,0.45)' },
    newcomer:   { fg: '#94a3b8', bg: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.40)' },
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
