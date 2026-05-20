import { useEffect } from 'react';
import { View, Text, FlatList, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNotifications } from '../../hooks/useNotifications';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { PressableScale } from '../../components/ui/PressableScale';
import { Divider } from '../../components/ui/Divider';
import { Icon } from '../../constants/icons';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { formatRelative } from '../../lib/utils/date';
import { TABBAR } from '../../design/tabbar';
import { NotificationSkeleton } from '../../components/ui/Skeleton';

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { notifications, loading: isLoading, markAllRead } = useNotifications();

  // 通知画面を開いたタイミングで既読化
  useEffect(() => {
    void markAllRead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isLoading && notifications.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <TopBar title="通知" left={<BackButton />} />
        <View>
          {Array.from({ length: 6 }).map((_, i) => (
            <NotificationSkeleton key={i} />
          ))}
        </View>
      </View>
    );
  }

  if (!isLoading && notifications.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <TopBar title="通知" left={<BackButton />} />
        <ScrollView contentContainerStyle={{ padding: SP['4'], gap: SP['4'] }}>
          {/* ヒーロー */}
          <View style={{ alignItems: 'center', padding: SP['6'], gap: SP['3'] }}>
            <View style={{
              width: 96, height: 96, borderRadius: 48,
              backgroundColor: C.accentBg, alignItems: 'center', justifyContent: 'center',
              borderWidth: 1, borderColor: C.accentSoft,
            }}>
              <Icon.bell size={44} color={C.accent} strokeWidth={1.8} />
            </View>
            <Text style={[T.h2, { color: C.text, textAlign: 'center' }]}>まだ通知はありません</Text>
            <Text style={[T.body, { color: C.text2, textAlign: 'center', maxWidth: 320 }]}>
              好きなタグの新着投稿、自分の投稿への反応などが届きます
            </Text>
          </View>

          <PressableScale
            onPress={() => router.push('/settings/notifications' as never)}
            haptic="tap"
            style={{
              marginTop: SP['2'],
              padding: SP['4'],
              backgroundColor: C.bg2,
              borderRadius: R.lg,
              borderWidth: 1,
              borderColor: C.border,
              flexDirection: 'row', alignItems: 'center', gap: SP['3'],
            }}
          >
            <Icon.settings size={20} color={C.text2} strokeWidth={2.2} />
            <Text style={[T.bodyM, { color: C.text, flex: 1 }]}>通知設定</Text>
            <Icon.chevronR size={18} color={C.text3} strokeWidth={2.2} />
          </PressableScale>
        </ScrollView>
      </View>
    );
  }

  const unreadCount = notifications.filter((n) => !n.read).length;

  // type → emoji
  const typeEmoji = (type: string): string => {
    switch (type) {
      case 'like': return '💛';
      case 'comment': return '💬';
      case 'follow': return '👤';
      case 'reply': return '↩';
      case 'event': return '📅';
      default: return '🔔';
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar
        title="通知"
        left={<BackButton />}
        right={
          unreadCount > 0 ? (
            <PressableScale
              onPress={() => void markAllRead()}
              haptic="confirm"
              style={{
                paddingHorizontal: SP['3'],
                paddingVertical: 6,
                backgroundColor: C.accent,
                borderRadius: R.full,
              }}
            >
              <Text style={[T.caption, { color: '#fff', fontWeight: '700' }]}>
                すべて既読
              </Text>
            </PressableScale>
          ) : null
        }
      />
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
              backgroundColor: item.read ? C.bg : C.accentBg,
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: SP['3'],
            }}
          >
            {/* 未読インジケータ */}
            {!item.read && (
              <View style={{
                position: 'absolute', left: 4, top: '50%',
                marginTop: -3,
                width: 6, height: 6, borderRadius: 3,
                backgroundColor: C.accent,
              }} />
            )}
            {/* type ごとの絵文字 */}
            <View style={{
              width: 36, height: 36, borderRadius: 18,
              backgroundColor: item.read ? C.bg3 : C.accent + '33',
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Text style={{ fontSize: 18 }}>{typeEmoji(item.type)}</Text>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[T.bodyM, { color: C.text, lineHeight: 20 }]}>
                {item.message}
              </Text>
              {item.tag_name && (
                <Text style={[T.small, { color: C.accent }]}>#{item.tag_name}</Text>
              )}
              <Text style={[T.caption, { color: C.text3 }]}>
                {formatRelative(item.created_at)}
              </Text>
            </View>
          </View>
        )}
      />
    </View>
  );
}

