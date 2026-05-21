import { View, Text, Platform } from 'react-native';
import { memo } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { C } from '../../design/tokens';
import { T } from '../../design/typography';
import { TABBAR } from '../../design/tabbar';
import { TabIcon, type TabKey } from './TabIcon';
import { HapticTab } from './HapticTab';
import { useNotifications } from '../../hooks/useNotifications';
import { NotificationBadge } from '../ui/NotificationBadge';

const ROUTE_TO_TAB: Record<string, TabKey> = {
  feed: 'home',
  bbs: 'bbs',
  community: 'community',
  mypage: 'mypage',
};

const LABELS: Record<TabKey, string> = {
  home: 'ホーム',
  bbs: '掲示板',
  game: 'ゲーム',
  community: 'コミュニティ',
  mypage: 'マイ',
};

// ============================================================
// Slack 風 浮遊型タブバー (dark)
// - 画面下に余白を持って "浮く" pill
// - active タブだけが accent 色の小さな pill で強調される
// - 背景は深い black + 薄い border / shadow で立体感
// ============================================================
export function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  // pill の下マージン — safeArea 下端 + 余白
  const bottomMargin = Math.max(insets.bottom, 8) + 8;
  const { unreadCount } = useNotifications();

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: 'center',
        paddingBottom: bottomMargin,
      }}
    >
      {/* pill 本体 — 浮遊型の dark capsule */}
      <View
        style={[
          {
            flexDirection: 'row',
            backgroundColor: '#141417',
            borderRadius: 32,
            paddingHorizontal: 8,
            paddingVertical: 6,
            gap: 2,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.06)',
            // shadow
            shadowColor: '#000',
            shadowOpacity: 0.5,
            shadowOffset: { width: 0, height: 8 },
            shadowRadius: 24,
            elevation: 12,
          },
          // web 用に backdrop-blur をオーバーレイ
          Platform.OS === 'web'
            ? ({
                backgroundColor: 'rgba(20,20,23,0.92)',
                backdropFilter: 'blur(20px) saturate(140%)',
                WebkitBackdropFilter: 'blur(20px) saturate(140%)',
              } as object)
            : null,
        ]}
      >
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
              <TabPill
                tab={tab}
                focused={focused}
                badgeCount={tab === 'mypage' ? unreadCount : 0}
              />
            </HapticTab>
          );
        })}
      </View>
    </View>
  );
}

// 個別の「ピル」型タブ — memo 化して unreadCount 変更時に
// mypage 以外の pill が再 render しないようにする
const TabPill = memo(function TabPill({
  tab,
  focused,
  badgeCount = 0,
}: {
  tab: TabKey;
  focused: boolean;
  badgeCount?: number;
}) {
  // active 時は accent 色の半透明 fill + icon/label が accent 色になる
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingVertical: 9,
        paddingHorizontal: focused ? 14 : 12,
        borderRadius: 22,
        backgroundColor: focused ? 'rgba(124,106,247,0.18)' : 'transparent',
        // active 時は subtle border + glow
        borderWidth: focused ? 1 : 0,
        borderColor: focused ? 'rgba(124,106,247,0.45)' : 'transparent',
        minHeight: 40,
      }}
    >
      <View style={{ overflow: 'visible' }}>
        <TabIcon tab={tab} focused={focused} size={22} />
        {badgeCount > 0 && (
          <NotificationBadge count={badgeCount} top={-4} right={-6} />
        )}
      </View>
      {focused && (
        <Text
          style={[
            T.caption,
            {
              color: C.accent,
              fontWeight: '700',
              letterSpacing: 0.2,
            },
          ]}
          numberOfLines={1}
        >
          {LABELS[tab]}
        </Text>
      )}
    </View>
  );
});
