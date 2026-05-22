import { Tabs } from 'expo-router';
import { TabBar } from '../../components/nav/TabBar';

// パフォーマンス: lazy: true で active tab のみ初期 mount。
// lazyPreloadDistance: 1 で隣接タブだけ preload。
// 起動時の同時 mount 数を 4 → 1 に減らし、初回ペイント ~800ms 短縮。
export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: false,
        lazy: true,
        lazyPreloadDistance: 1,
      } as object}
    >
      <Tabs.Screen name="feed" />
      <Tabs.Screen name="bbs" />
      <Tabs.Screen name="community" />
      <Tabs.Screen name="mypage" />
    </Tabs>
  );
}
