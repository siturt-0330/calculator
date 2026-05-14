import { View, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, R, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import { GRAD } from '@/design/tokens';

export function TrustBar({ score, compact }: { score: number; compact?: boolean }) {
  if (compact) {
    return (
      <View
        style={{ height: 4, borderRadius: R.full, backgroundColor: C.bg3, overflow: 'hidden', width: 80 }}
      >
        <LinearGradient
          colors={[...GRAD.trust]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${Math.min(score, 100)}%`,
          }}
        />
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
        <LinearGradient
          colors={[...GRAD.trust]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${Math.min(score, 100)}%`,
            borderRadius: R.full,
          }}
        />
      </View>
    </View>
  );
}
