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
// タブは lazy: true (初回フォーカス時 mount)。旧 lazyPreloadDistance:2 は react-navigation v7
// の bottom-tabs に存在せず no-op だったため撤去 [実証済: node_modules grep 0 件]。
// タブ即時表示のデータ/画像温めは app/_layout.tsx (root) の RQ prewarm effect が担当。
// =============================================================================

import { useWindowDimensions, View, Platform } from 'react-native';
import { Tabs } from 'expo-router';
import { TabBar } from '../../components/nav/TabBar';
import { LeftSidebar } from '../../components/nav/LeftSidebar';
import { RightSearchPanel } from '../../components/nav/RightSearchPanel';
import { useTheme } from '../../hooks/useColors';
import { TabBarScrollProvider } from '../../lib/contexts/tabBarScroll';

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
        // 非フォアグラウンドのタブを react-freeze で凍結 — 裏タブの realtime/RQ 由来の
        // 再レンダ/effect を停止し、前面のスクロール/遷移にフレーム予算を回す (native のみ。
        // Web は screens 無効のため no-op)。state は保持・unmount しない。
        freezeOnBlur: true,
      }}
    >
      <Tabs.Screen name="feed" />
      <Tabs.Screen name="search" />
      <Tabs.Screen name="community" />
      <Tabs.Screen name="mypage" />
    </Tabs>
  );

  // モバイル / デスクトップ いずれでも、TabBar が読む scrollY SharedValue を
  // タブナビ全体で共有する Provider をルートに置く (2026-06-12)。
  // デスクトップでは TabBar 自体は描画されないが、Provider があっても無害
  // (各画面の onScroll が SV に書き込むだけで、購読側が居なければ no-op)。
  if (!isDesktop) return <TabBarScrollProvider>{tabs}</TabBarScrollProvider>;

  // デスクトップ Web: 3 カラム並び (左 sidebar / 中央 Tabs / 右 検索パネル)。
  // 中央は flex:1 + maxWidth で X と同じ「狭めで読みやすい」幅に収める。
  return (
    <TabBarScrollProvider>
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: C.bg }}>
        <LeftSidebar />
        <View style={{ flex: 1, maxWidth: 720, alignSelf: 'stretch' }}>{tabs}</View>
        <RightSearchPanel />
      </View>
    </TabBarScrollProvider>
  );
}
