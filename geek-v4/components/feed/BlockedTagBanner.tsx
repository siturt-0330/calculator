import { View, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Icon } from '../../constants/icons';
import { PressableScale } from '../ui/PressableScale';
import { C, R, SP, SHADOW } from '../../design/tokens';
import { T } from '../../design/typography';

export function BlockedTagBanner({ count, onPress }: { count: number; onPress: () => void }) {
  const Ban = Icon.block;
  const ChevR = Icon.chevronR;
  // gradient + subtle border の "warning card" 風 — フィードの上品な雰囲気と整合。
  // 旧 flat な C.blockBg は少し質感に乏しかったので、ごく弱いグラデでカード感を出す。
  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      style={{
        marginHorizontal: SP['4'],
        marginTop: SP['3'],
        borderRadius: R.lg,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: C.blockBorder,
        ...SHADOW.sm,
      }}
    >
      <LinearGradient
        colors={['rgba(204,112,112,0.18)', 'rgba(204,112,112,0.06)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          padding: SP['3'],
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['3'],
        }}
      >
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(204,112,112,0.15)',
          }}
        >
          <Ban size={16} color={C.block} strokeWidth={2.2} />
        </View>
        <Text style={[T.smallM, { color: C.block, flex: 1 }]}>{count}個のタグを除外中</Text>
        <ChevR size={18} color={C.block} strokeWidth={2.2} />
      </LinearGradient>
    </PressableScale>
  );
}
