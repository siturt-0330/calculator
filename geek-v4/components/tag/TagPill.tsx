import { Text } from 'react-native';
import { PressableScale } from '../ui/PressableScale';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { Icon } from '../../constants/icons';

type State = 'normal' | 'liked' | 'blocked' | 'added' | 'alias' | 'group';
type PillSize = 'sm' | 'md';

const STATE_STYLE: Record<State, { bg: string; border: string; color: string }> = {
  normal:  { bg: C.bg3,         border: C.border,         color: C.text },
  liked:   { bg: C.likedBg,     border: C.liked,          color: C.accentLight },
  blocked: { bg: C.blockBg,     border: C.blockBorder,    color: C.block },
  added:   { bg: C.sameGenreBg, border: C.sameGenreBorder, color: C.sameGenre },
  alias:   { bg: C.sameGroupBg, border: C.sameGroupBorder, color: C.sameGroup },
  group:   { bg: C.relatedBg,   border: C.relatedBorder,   color: C.related },
};

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
  const Plus = Icon.plus;
  const Link = Icon.shield;
  const { bg, border, color } = STATE_STYLE[state];

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
      {state === 'liked'   && <Heart size={12} color={color} fill={color} strokeWidth={2.2} />}
      {state === 'blocked' && <Ban   size={12} color={color} strokeWidth={2.2} />}
      {state === 'added'   && <Plus  size={12} color={color} strokeWidth={2.6} />}
      {state === 'alias'   && <Link  size={12} color={color} strokeWidth={2.2} />}
      <Text style={[size === 'sm' ? T.small : T.bodyM, { color }]}>#{name}</Text>
    </PressableScale>
  );
}
