import { View, Text, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { C } from '@/design/tokens';
import { T } from '@/design/typography';
import { TABBAR } from '@/design/tabbar';
import { TabIcon, type TabKey } from './TabIcon';
import { HapticTab } from './HapticTab';
import { useNotifications } from '@/hooks/useNotifications';
import { NotificationBadge } from '@/components/ui/NotificationBadge';

const ROUTE_TO_TAB: Record<string, TabKey> = {
  feed: 'home',
  bbs: 'bbs',
  oshi: 'oshi',
  mypage: 'mypage',
};

const LABELS: Record<TabKey, string> = {
  home: 'ホーム',
  bbs: '掲示板',
  game: 'ゲーム',
  oshi: '推し活',
  mypage: 'マイ',
};

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 8);
  const { unreadCount } = useNotifications();

  return (
    <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
      <BlurView
        intensity={Platform.OS === 'ios' ? TABBAR.bgBlur : 0}
        tint="dark"
        style={{
          paddingBottom: bottomPad,
          backgroundColor:
            Platform.OS === 'ios' ? 'rgba(10,10,10,0.72)' : 'rgba(10,10,10,0.96)',
          borderTopWidth: 1,
          borderTopColor: C.border,
        }}
      >
        <View style={{ flexDirection: 'row', height: TABBAR.height }}>
          {state.routes.map((route, index) => {
            const focused = state.index === index;
            const tab = ROUTE_TO_TAB[route.name];
            if (!tab) return null;

            const onPress = () => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) {
                navigation.navigate(route.name, route.params as never);
              }
            };

            return (
              <HapticTab key={route.key} focused={focused} onPress={onPress}>
                <View
                  style={{ alignItems: 'center', gap: TABBAR.labelGap, marginTop: 6 }}
                >
                  <View>
                    <TabIcon tab={tab} focused={focused} />
                    {tab === 'mypage' && (
                      <NotificationBadge count={unreadCount} top={-3} right={-6} />
                    )}
                  </View>
                  <Text style={[T.caption, { color: focused ? C.accent : C.text3 }]}>
                    {LABELS[tab]}
                  </Text>
                </View>
              </HapticTab>
            );
          })}
        </View>
      </BlurView>
    </View>
  );
}
