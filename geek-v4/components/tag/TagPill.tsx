import { Text } from 'react-native';
import { PressableScale } from '@/components/ui/PressableScale';
import { C, R, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import { Icon } from '@/constants/icons';

type State = 'normal' | 'liked' | 'blocked';
type PillSize = 'sm' | 'md';

export function TagPill({
  name,
  state = 'normal',
  size = 'sm',
  onPress,
  onLongPress,
}: {
  name: string;
  state?: State;
  size?: PillSize;
  onPress?: () => void;
  onLongPress?: () => void;
}) {
  const Heart = Icon.heart;
  const Ban = Icon.block;
  const bg = state === 'liked' ? C.likedBg : state === 'blocked' ? C.blockBg : C.bg3;
  const border = state === 'liked' ? C.liked : state === 'blocked' ? C.blockBorder : C.border;
  const color = state === 'liked' ? C.accentLight : state === 'blocked' ? C.block : C.text;

  return (
    <PressableScale
      onPress={onPress}
      onLongPress={onLongPress}
      haptic="select"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['1'],
        paddingHorizontal: size === 'sm' ? SP['3'] : SP['4'],
        paddingVertical: size === 'sm' ? SP['1'] : SP['2'],
        borderRadius: R.full,
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: border,
      }}
    >
      {state === 'liked' && <Heart size={12} color={color} fill={color} strokeWidth={2.2} />}
      {state === 'blocked' && <Ban size={12} color={color} strokeWidth={2.2} />}
      <Text style={[size === 'sm' ? T.small : T.bodyM, { color }]}>#{name}</Text>
    </PressableScale>
  );
}
