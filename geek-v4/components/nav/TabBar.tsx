import { View, Platform } from 'react-native';
import { memo } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { TabIcon, type TabKey } from './TabIcon';
import { HapticTab } from './HapticTab';
import { useNotifications } from '../../hooks/useNotifications';
import { NotificationBadge } from '../ui/NotificationBadge';
import { useResolvedTheme } from '../../lib/theme/themeStore';

const ROUTE_TO_TAB: Record<string, TabKey> = {
  feed: 'home',
  bbs: 'bbs',
  community: 'community',
  mypage: 'mypage',
};

// 各 tab の固定サイズ — 全 tab 等幅で container 全体の幅が変動しないようにする
const TAB_WIDTH = 48;
const TAB_HEIGHT = 40;
const TAB_BR = 20;

// ============================================================
// Slack 風 浮遊型タブバー (dark)
// - 画面下に余白を持って "浮く" pill
// - 全 tab は icon-only / 等幅。active は背景 fill + icon 色変化で示す
// - label テキストは表示しない (active で幅が伸びて container サイズが揺れる事故対策)
// ============================================================
export function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  // pill の下マージン — safeArea 下端 + 余白
  const bottomMargin = Math.max(insets.bottom, 8) + 8;
  const { unreadCount } = useNotifications();
  const theme = useResolvedTheme();
  const isDark = theme === 'dark';
  // テーマ別 pill 配色 — dark は黒 base + 紫 active, light は白 base + 紫 active
  const pillBg = isDark ? '#141417' : '#ffffff';
  const pillBgWeb = isDark ? 'rgba(20,20,23,0.94)' : 'rgba(255,255,255,0.92)';
  const pillBorder = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)';
  const pillShadowColor = isDark ? '#000' : '#0a0a0a';
  const pillShadowOpacity = isDark ? 0.5 : 0.12;

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
      {/* pill 本体 — 浮遊型の dark/light capsule
           全 tab が等幅 (TAB_WIDTH) で active 切替時も container 全幅が変わらない.
           pill の BR は container BR より小さく取り, paddingH で角差を吸収. */}
      <View
        style={[
          {
            flexDirection: 'row',
            backgroundColor: pillBg,
            borderRadius: 28,
            paddingHorizontal: 8,
            paddingVertical: 6,
            gap: 2,
            borderWidth: 1,
            borderColor: pillBorder,
            overflow: 'hidden',
            // shadow — light テーマでは控えめに
            shadowColor: pillShadowColor,
            shadowOpacity: pillShadowOpacity,
            shadowOffset: { width: 0, height: 8 },
            shadowRadius: 24,
            elevation: 12,
          },
          // web 用に backdrop-blur をオーバーレイ
          // パフォーマンス監査: 20px → 14px に削減 (Safari の scroll 時 re-composite cost -25%)
          Platform.OS === 'web'
            ? ({
                backgroundColor: pillBgWeb,
                backdropFilter: 'blur(14px)',
                WebkitBackdropFilter: 'blur(14px)',
                willChange: 'transform',
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
// 全 tab 同一サイズ (TAB_WIDTH x TAB_HEIGHT). active state は背景色のみで表現.
const TabPill = memo(function TabPill({
  tab,
  focused,
  badgeCount = 0,
}: {
  tab: TabKey;
  focused: boolean;
  badgeCount?: number;
}) {
  return (
    <View
      style={{
        width: TAB_WIDTH,
        height: TAB_HEIGHT,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: TAB_BR,
        backgroundColor: focused ? 'rgba(124,106,247,0.18)' : 'transparent',
        // active 時は subtle border + glow
        borderWidth: focused ? 1 : 0,
        borderColor: focused ? 'rgba(124,106,247,0.45)' : 'transparent',
      }}
    >
      <View style={{ overflow: 'visible' }}>
        <TabIcon tab={tab} focused={focused} size={22} />
        {badgeCount > 0 && (
          <NotificationBadge count={badgeCount} top={-4} right={-6} />
        )}
      </View>
    </View>
  );
});
