import { Text } from 'react-native';
import { Icon } from '../../constants/icons';
import { PressableScale } from '../ui/PressableScale';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';

export function BlockedTagBanner({ count, onPress }: { count: number; onPress: () => void }) {
  const Ban = Icon.block;
  const ChevR = Icon.chevronR;
  return (
    <PressableScale
      onPress={onPress}
      style={{
        marginHorizontal: SP['4'],
        marginTop: SP['3'],
        padding: SP['3'],
        borderRadius: R.lg,
        backgroundColor: C.blockBg,
        borderWidth: 1,
        borderColor: C.blockBorder,
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['3'],
      }}
    >
      <Ban size={18} color={C.block} strokeWidth={2.2} />
      <Text style={[T.small, { color: C.block, flex: 1 }]}>{count}個のタグを除外中</Text>
      <ChevR size={18} color={C.block} strokeWidth={2.2} />
    </PressableScale>
  );
}
