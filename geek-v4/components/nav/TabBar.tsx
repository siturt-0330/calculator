import { View, Text, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { C } from '@/design/tokens';
import { T } from '@/design/typography';
import { TABBAR } from '@/design/tabbar';
import { TabIcon, type TabKey } from './TabIcon';
import { HapticTab } from './HapticTab';
import { FAB } from './FAB';

const ROUTE_TO_TAB: Record<string, TabKey> = {
  feed: 'home',
  corners: 'corners',
  post: 'post',
  bbs: 'bbs',
  mypage: 'mypage',
};

const LABELS: Record<TabKey, string> = {
  home: 'ホーム',
  corners: 'コーナー',
  post: '',
  bbs: '掲示板',
  mypage: 'マイ',
};

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 8);

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

            if (tab === 'post') {
              return (
                <View key={route.key} style={{ flex: 1, alignItems: 'center' }}>
                  <FAB onPress={onPress} />
                </View>
              );
            }

            return (
              <HapticTab key={route.key} focused={focused} onPress={onPress}>
                <View
                  style={{ alignItems: 'center', gap: TABBAR.labelGap, marginTop: 6 }}
                >
                  <TabIcon tab={tab} focused={focused} />
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
