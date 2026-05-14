import { View, Text, FlatList } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { fetchNotifications } from '@/lib/api/notifications';
import { TopBar } from '@/components/nav/TopBar';
import { BackButton } from '@/components/nav/BackButton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Divider } from '@/components/ui/Divider';
import { Icon } from '@/constants/icons';
import { C, R, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import { formatRelative } from '@/lib/utils/date';
import { TABBAR } from '@/design/tabbar';

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: fetchNotifications,
  });

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="通知" left={<BackButton />} />
      <FlatList
        data={notifications}
        keyExtractor={(n) => n.id}
        contentContainerStyle={{
          paddingBottom: TABBAR.height + insets.bottom + SP['10'],
        }}
        ItemSeparatorComponent={() => <Divider />}
        renderItem={({ item }) => (
          <View
            style={{
              padding: SP['4'],
              gap: SP['1'],
              backgroundColor: item.read ? C.bg : C.accentBg,
            }}
          >
            <Text style={[T.bodyM, { color: C.text }]}>{item.message}</Text>
            {item.tag_name && (
              <Text style={[T.small, { color: C.accent }]}>#{item.tag_name}</Text>
            )}
            <Text style={[T.caption, { color: C.text3 }]}>
              {formatRelative(item.created_at)}
            </Text>
          </View>
        )}
        ListEmptyComponent={
          !isLoading ? (
            <EmptyState
              icon={Icon.bell}
              title="通知はありません"
              message="好きなタグに投稿があると通知が届きます"
            />
          ) : null
        }
      />
    </View>
  );
}
