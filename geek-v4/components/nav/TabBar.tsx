import { View, Platform, Text, StyleSheet } from 'react-native';
import { memo } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { TabIcon, type TabKey } from './TabIcon';
import { HapticTab } from './HapticTab';
import { useNotifications } from '../../hooks/useNotifications';
import { NotificationBadge } from '../ui/NotificationBadge';
import { useResolvedTheme } from '../../lib/theme/themeStore';
import { useColors } from '../../hooks/useColors';

// ============================================================
// iOS-native bottom tab bar
// ------------------------------------------------------------
// 設計 (2026-05-28 refresh):
//   - expo-blur の BlurView を backdrop に敷き、iOS の system material 風に。
//     intensity=80, tint='systemUltraThinMaterial' (iOS 13+ native key)。
//     fallback では `tint` を 'dark'/'light' に切替。
//   - 高さは iOS 標準の 49pt + safe-area bottom inset。pill 形ではなく
//     フラットな edge-to-edge bar (HIG 準拠)。上端 hairline border。
//   - active tab: theme primary (C.accent), inactive: '#8E8E93' (iOS systemGray)。
//   - icon は 24pt, label は 10pt (active は 11pt + semibold)。
//   - press 時 haptic は HapticTab 側で発火 (light impact = select)。
//   - web は CSS backdrop-filter: blur(30px) + rgba 重ね、native は BlurView。
// ============================================================
const ROUTE_TO_TAB: Record<string, TabKey> = {
  feed: 'home',
  search: 'search',
  community: 'community',
  mypage: 'mypage',
};

const TAB_TO_LABEL: Record<TabKey, string> = {
  home: 'ホーム',
  search: '検索',
  game: 'ゲーム',
  community: 'コミュ',
  mypage: 'マイ',
};

// iOS HIG: tab bar 内コンテンツ高さは 49pt 固定。safe-area inset は別途加算。
const BAR_HEIGHT = 49;
// iOS systemGray (inactive tab tint)
const INACTIVE_TINT = '#8E8E93';
// icon 24pt は iOS HIG default
const ICON_SIZE = 24;

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { unreadCount } = useNotifications();
  const theme = useResolvedTheme();
  const C = useColors();
  const isDark = theme === 'dark';

  // BlurView の tint: iOS は systemUltraThinMaterial を最優先
  // (RN expo-blur の TS def によっては string キャストが必要)
  const blurTint = (
    isDark ? 'systemUltraThinMaterialDark' : 'systemUltraThinMaterialLight'
  ) as 'systemUltraThinMaterialDark' | 'systemUltraThinMaterialLight';

  // web 用: CSS backdrop-filter で iOS 風 blur を再現
  const webBgColor = isDark ? 'rgba(0,0,0,0.70)' : 'rgba(255,255,255,0.70)';
  // 上端 hairline (iOS 標準 1px の半透明 separator)
  const hairlineColor = isDark
    ? 'rgba(255,255,255,0.10)'
    : 'rgba(0,0,0,0.10)';
  // BlurView の下に敷くフォールバック背景 (Android / blur 未対応端末で透けないように)
  const fallbackBg = isDark ? 'rgba(20,20,23,0.92)' : 'rgba(250,250,252,0.88)';

  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
      }}
    >
      {/* Blur backdrop — iOS は expo-blur, web は CSS backdrop-filter */}
      {Platform.OS === 'web' ? (
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: webBgColor,
            },
            // backdrop-filter は RN web 側で型に乗ってないため as object でキャスト
            {
              backdropFilter: 'blur(30px) saturate(180%)',
              WebkitBackdropFilter: 'blur(30px) saturate(180%)',
            } as object,
          ]}
        />
      ) : (
        <>
          {/* fallback bg — blur が効かない / 描画される前に透けないようにする */}
          <View
            style={[StyleSheet.absoluteFill, { backgroundColor: fallbackBg }]}
          />
          <BlurView
            intensity={80}
            tint={blurTint}
            style={StyleSheet.absoluteFill}
          />
        </>
      )}

      {/* 上端 hairline */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: StyleSheet.hairlineWidth,
          backgroundColor: hairlineColor,
        }}
      />

      <View
        style={{
          flexDirection: 'row',
          height: BAR_HEIGHT,
          paddingBottom: 0,
          paddingTop: 4,
          paddingHorizontal: 4,
        }}
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
              <TabItem
                tab={tab}
                focused={focused}
                accent={C.accent}
                badgeCount={tab === 'mypage' ? unreadCount : 0}
              />
            </HapticTab>
          );
        })}
      </View>

      {/* safe-area bottom inset を別 view で確保 (背景の blur は全領域に伸ばす) */}
      <View style={{ height: insets.bottom }} />
    </View>
  );
}

// ============================================================
// TabItem — 個別タブ (icon + label)
// ------------------------------------------------------------
// iOS-native 配色:
//   - active: accent (theme primary)
//   - inactive: '#8E8E93' (iOS systemGray)
//   - label: 10pt regular, active は 11pt semibold で「重み」を出す
//   - icon は 24pt
// memo 化して unreadCount 変化時に対象 tab 以外を re-render しない
// ============================================================
const TabItem = memo(function TabItem({
  tab,
  focused,
  accent,
  badgeCount = 0,
}: {
  tab: TabKey;
  focused: boolean;
  accent: string;
  badgeCount?: number;
}) {
  const label = TAB_TO_LABEL[tab];
  const color = focused ? accent : INACTIVE_TINT;
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'flex-start',
        paddingTop: 2,
      }}
    >
      <View style={{ width: ICON_SIZE, height: ICON_SIZE, overflow: 'visible' }}>
        <TabIcon tab={tab} focused={focused} size={ICON_SIZE} />
        {badgeCount > 0 && (
          <NotificationBadge count={badgeCount} top={-4} right={-6} />
        )}
      </View>
      <Text
        numberOfLines={1}
        style={{
          marginTop: 2,
          fontSize: focused ? 11 : 10,
          lineHeight: 13,
          fontWeight: focused ? '600' : '500',
          color,
          letterSpacing: 0.1,
        }}
      >
        {label}
      </Text>
    </View>
  );
});
