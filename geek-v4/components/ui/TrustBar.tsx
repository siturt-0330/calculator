import { View, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, R, SP, GRAD } from '../../design/tokens';
import { T } from '../../design/typography';
import type { TrustTier } from '../../lib/trust/score';

type Props = {
  score: number;
  compact?: boolean;
  tier?: TrustTier;
};

export function TrustBar({ score, compact, tier }: Props) {
  const pct = Math.min(Math.max(score, 0), 100);
  if (compact) {
    return (
      <View
        style={{ height: 4, borderRadius: R.full, backgroundColor: C.bg3, overflow: 'hidden', width: 80 }}
      >
        {tier ? (
          <View
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: `${pct}%`,
              backgroundColor: tier.color,
            }}
          />
        ) : (
          <LinearGradient
            colors={[...GRAD.trust]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: `${pct}%`,
            }}
          />
        )}
      </View>
    );
  }
  return (
    <View style={{ gap: SP['1'] }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={[T.smallM, { color: C.text2 }]}>信頼スコア</Text>
        <Text style={[T.num, { color: C.text }]}>{score}</Text>
      </View>
      <View
        style={{ height: 6, borderRadius: R.full, backgroundColor: C.bg3, overflow: 'hidden' }}
      >
        {tier ? (
          <View
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: `${pct}%`,
              backgroundColor: tier.color,
              borderRadius: R.full,
            }}
          />
        ) : (
          <LinearGradient
            colors={[...GRAD.trust]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: `${pct}%`,
              borderRadius: R.full,
            }}
          />
        )}
      </View>
    </View>
  );
}
