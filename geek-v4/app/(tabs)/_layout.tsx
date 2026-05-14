import { Tabs } from 'expo-router';
import { TabBar } from '@/components/nav/TabBar';

export default function TabsLayout() {
  return (
    <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="feed" />
      <Tabs.Screen name="corners" />
      <Tabs.Screen
        name="post"
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            e.preventDefault();
            navigation.navigate('post/create' as never);
          },
        })}
      />
      <Tabs.Screen name="bbs" />
      <Tabs.Screen name="mypage" />
    </Tabs>
  );
}
