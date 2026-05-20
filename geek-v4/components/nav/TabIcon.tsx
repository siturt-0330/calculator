import { View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { C } from '../../design/tokens';
import { TABBAR } from '../../design/tabbar';
import { Icon, type IconName } from '../../constants/icons';

export type TabKey = 'home' | 'bbs' | 'game' | 'community' | 'mypage';

const TAB_TO_ICON: Record<TabKey, IconName> = {
  home: 'home',
  bbs: 'bbs',
  game: 'game',
  community: 'community',
  mypage: 'mypage',
};

export function TabIcon({
  tab,
  focused,
  size = TABBAR.iconSize,
}: {
  tab: TabKey;
  focused: boolean;
  size?: number;
}) {
  const I: LucideIcon = Icon[TAB_TO_ICON[tab]];
  return (
    <View
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
    >
      <I size={size} strokeWidth={TABBAR.iconStroke} color={focused ? C.accent : C.text2} />
    </View>
  );
}
