// =============================================================================
// (tabs)/_layout.tsx — タブナビ + デスクトップ Web は 3 カラムレイアウト
// -----------------------------------------------------------------------------
// モバイル: 従来どおり下部 TabBar + ホームの HomeDrawer (右スワイプ) で全機能。
// デスクトップ (Web, width >= 1100px): X 風 3 カラム
//   - 左   : LeftSidebar (固定 260)  — ナビ + 投稿 + アカウント
//   - 中央 : Tabs (現行の feed/search/community/mypage)
//   - 右   : RightSearchPanel (固定 340) — 検索バー + トレンド
// PC のとき下部 TabBar は非表示 (LeftSidebar に統合済み)。
//
// タブ切替を即時化 (IG/YouTube 風): lazy: true + lazyPreloadDistance: 2 で、feed の
// 隣接タブ (search / community) を first paint 後にバックグラウンド mount しておく。
// → データ + リスト先頭のメディアが事前ロードされ、タブを開いた瞬間に表示される。
// =============================================================================

import { useWindowDimensions, View, Platform } from 'react-native';
import { Tabs } from 'expo-router';
import { TabBar } from '../../components/nav/TabBar';
import { LeftSidebar } from '../../components/nav/LeftSidebar';
import { RightSearchPanel } from '../../components/nav/RightSearchPanel';
import { useTheme } from '../../hooks/useColors';

// 3 カラム化する横幅の閾値 (左 260 + 中央 600 + 右 340 + 余白)。
// 1100 未満はモバイル相当の単一カラム + 下部 TabBar。
const DESKTOP_BREAKPOINT = 1100;

export default function TabsLayout() {
  const { width } = useWindowDimensions();
  const { C } = useTheme();
  // Web の十分広いビューポートでだけ 3 カラム表示にする。
  // (RN ネイティブは Platform.OS !== 'web' で常にモバイル UI のまま)
  const isDesktop = Platform.OS === 'web' && width >= DESKTOP_BREAKPOINT;

  // 中央カラム (Tabs) — PC では tabBar を非表示にしてサイドバーに集約。
  const tabs = (
    <Tabs
      tabBar={(props) => (isDesktop ? null : <TabBar {...props} />)}
      screenOptions={{
        headerShown: false,
        lazy: true,
        // 1 → 2: feed から search / community を背景 preload してタブ即時表示
        lazyPreloadDistance: 2,
      } as object}
    >
      <Tabs.Screen name="feed" />
      <Tabs.Screen name="search" />
      <Tabs.Screen name="community" />
      <Tabs.Screen name="mypage" />
    </Tabs>
  );

  if (!isDesktop) return tabs;

  // デスクトップ Web: 3 カラム並び (左 sidebar / 中央 Tabs / 右 検索パネル)。
  // 中央は flex:1 + maxWidth で X と同じ「狭めで読みやすい」幅に収める。
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: C.bg }}>
      <LeftSidebar />
      <View style={{ flex: 1, maxWidth: 720, alignSelf: 'stretch' }}>{tabs}</View>
      <RightSearchPanel />
    </View>
  );
}
