import { View, Platform, Text } from 'react-native';
import { memo } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { TabIcon, type TabKey } from './TabIcon';
import { HapticTab } from './HapticTab';
import { useNotifications } from '../../hooks/useNotifications';
import { NotificationBadge } from '../ui/NotificationBadge';
import { useResolvedTheme } from '../../lib/theme/themeStore';
import { useColors } from '../../hooks/useColors';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';

// ============================================================
// Floating pill TabBar — 「昔の TabBar」リバイバル (2026-05-29)
// ------------------------------------------------------------
// 設計:
//   - edge-to-edge bar を捨て、画面下に「浮く」 pill 形に戻す。
//     marginHorizontal: 20, marginBottom: insets.bottom + 12,
//     height: 56, borderRadius: 28 (= 高さの半分で full pill)。
//   - BlurView は使わない。視認性を優先して semi-transparent な
//     ベタ塗り背景 + subtle border 1pt + soft shadow で 3D 感を出す。
//   - active tab: pill 内に小 chip 化 (accent bg + label 表示)。
//     inactive tab: icon のみセンタリング (label 非表示)。
//   - flexDirection: row で 4 tab を均等割り。各 tab は flex: 1。
//   - dark / light 完全対応 (useColors)。
//   - haptic + press scale は HapticTab 側で完結。
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

// floating pill 形のパラメータ
const PILL_HEIGHT = 56;
const PILL_RADIUS = 28; // = PILL_HEIGHT / 2
const PILL_MARGIN_H = 20;
const PILL_MARGIN_B = 12; // safe-area inset に加算
const ICON_SIZE = 24;

// 投稿追加ボタン (pill 右隣の丸 FAB) のパラメータ
// Slack mobile の「検索丸」位置に投稿作成ボタンを置く (2026-05-29)
const FAB_SIZE = 56; // pill 高さと揃えて視覚的に統一
const FAB_GAP = 10; // pill と FAB の間隔

// active chip 形のパラメータ (pill 内 1 つだけ表示)
const CHIP_HEIGHT = 40;
const CHIP_RADIUS = 20;
const CHIP_PADDING_H = 14;

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { unreadCount } = useNotifications();
  const theme = useResolvedTheme();
  const C = useColors();
  const isDark = theme === 'dark';

  // pill の背景 — 視認性のため semi-opaque (0.95 相当)。
  //   dark: ほぼ黒の panel 色
  //   light: ほぼ白の panel 色
  const pillBg = isDark ? 'rgba(20,20,22,0.95)' : 'rgba(255,255,255,0.95)';
  // pill の border — 浮遊感を出す薄い stroke
  const pillBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

  // shadow — 仕様: opacity 0.12, radius 24, offset {0, 8}
  const shadowStyle = {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: isDark ? 0.45 : 0.12,
    shadowRadius: 24,
    elevation: 12,
  };

  // web 用 cursor / tap-highlight 抑止
  const webExtra =
    Platform.OS === 'web'
      ? ({
          // box-shadow を CSS で補強 (RN shadow は web で elevation を出さない)
          boxShadow: isDark
            ? '0 8px 24px rgba(0,0,0,0.45)'
            : '0 8px 24px rgba(0,0,0,0.12)',
        } as Record<string, unknown>)
      : null;

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
      }}
    >
      {/* pill + 投稿追加 FAB を横並び。margin はこの外側 row が持ち、
          pill は flex:1 で残り幅いっぱい、FAB は右端の丸ボタン。
          box-none で pill と FAB の隙間はタップを背後へ通す。 */}
      <View
        pointerEvents="box-none"
        style={{
          marginHorizontal: PILL_MARGIN_H,
          marginBottom: insets.bottom + PILL_MARGIN_B,
          flexDirection: 'row',
          alignItems: 'center',
          gap: FAB_GAP,
        }}
      >
        <View
          style={[
            {
              flex: 1,
              height: PILL_HEIGHT,
              borderRadius: PILL_RADIUS,
              backgroundColor: pillBg,
              borderWidth: 1,
              borderColor: pillBorder,
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 6,
              overflow: 'visible',
            },
            shadowStyle,
            webExtra as object,
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
                <TabItem
                  tab={tab}
                  focused={focused}
                  accent={C.accent}
                  accentBg={C.accentSoft}
                  badgeCount={tab === 'mypage' ? unreadCount : 0}
                />
              </HapticTab>
            );
          })}
        </View>

        {/* 投稿追加ボタン (丸 FAB) — Slack mobile の「検索丸」位置に
            投稿作成導線を配置 (検索はタブ側に残す)。 */}
        <PressableScale
          onPress={() => router.push('/post/create' as never)}
          haptic="tap"
          accessibilityLabel="投稿を作成"
          style={[
            {
              width: FAB_SIZE,
              height: FAB_SIZE,
              borderRadius: FAB_SIZE / 2,
              backgroundColor: C.accent,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: pillBorder,
            },
            shadowStyle,
            webExtra as object,
          ]}
        >
          <Icon.plus size={26} color="#fff" strokeWidth={2.6} />
        </PressableScale>
      </View>
    </View>
  );
}

// ============================================================
// TabItem — 個別タブ
// ------------------------------------------------------------
// - inactive: アイコンのみ中央配置 (label 非表示)
// - active:   accent bg の小 chip + アイコン + label 横並び
// memo 化で unreadCount 変化時に対象 tab 以外を re-render しない
// ============================================================
const TabItem = memo(function TabItem({
  tab,
  focused,
  accent,
  accentBg,
  badgeCount = 0,
}: {
  tab: TabKey;
  focused: boolean;
  accent: string;
  accentBg: string;
  badgeCount?: number;
}) {
  const label = TAB_TO_LABEL[tab];

  if (focused) {
    // active chip — accent bg + icon + label を横並び
    return (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          height: CHIP_HEIGHT,
          borderRadius: CHIP_RADIUS,
          paddingHorizontal: CHIP_PADDING_H,
          backgroundColor: accentBg,
          // cell 幅を超えて pill 外に飛び出さないための安全弁。
          // 通常は flex:2 の cell に収まるが、極端に狭い画面では
          // ここで頭打ちし label 側を flexShrink で truncate させる。
          maxWidth: '100%',
        }}
      >
        <View style={{ width: ICON_SIZE, height: ICON_SIZE, overflow: 'visible' }}>
          <TabIcon tab={tab} focused={true} size={ICON_SIZE} showLabel={false} />
          {badgeCount > 0 && (
            <NotificationBadge count={badgeCount} top={-4} right={-6} />
          )}
        </View>
        <Text
          numberOfLines={1}
          style={{
            marginLeft: 6,
            fontSize: 13,
            lineHeight: 16,
            fontWeight: '700',
            color: accent,
            letterSpacing: 0.1,
            // 狭い画面で chip が maxWidth に当たったら label を縮めて truncate
            flexShrink: 1,
          }}
        >
          {label}
        </Text>
      </View>
    );
  }

  // inactive — icon のみ中央 (label 非表示)
  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        height: CHIP_HEIGHT,
      }}
    >
      <View style={{ width: ICON_SIZE, height: ICON_SIZE, overflow: 'visible' }}>
        <TabIcon tab={tab} focused={false} size={ICON_SIZE} showLabel={false} />
        {badgeCount > 0 && (
          <NotificationBadge count={badgeCount} top={-4} right={-6} />
        )}
      </View>
    </View>
  );
});

