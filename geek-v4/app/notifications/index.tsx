import { useEffect, useMemo } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNotifications } from '../../hooks/useNotifications';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { PressableScale } from '../../components/ui/PressableScale';
import { Icon } from '../../constants/icons';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { formatRelative } from '../../lib/utils/date';
import { TABBAR } from '../../design/tabbar';
import { NotificationSkeleton } from '../../components/ui/Skeleton';
import { supabase } from '../../lib/supabase';
import type { Notification } from '../../types/models';

// 通知を 4 つの時間バケットへグルーピング
type Bucket = '今日' | '昨日' | '1週間以内' | 'それ以前';

function bucketFor(dateStr: string): Bucket {
  const now = new Date();
  const d = new Date(dateStr);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const startOfWeek = startOfToday - 7 * 24 * 60 * 60 * 1000;
  const t = d.getTime();
  if (t >= startOfToday) return '今日';
  if (t >= startOfYesterday) return '昨日';
  if (t >= startOfWeek) return '1週間以内';
  return 'それ以前';
}

// FlashList 用の行データ — section ヘッダーは別 type で混在させる
type Row =
  | { kind: 'header'; bucket: Bucket; id: string }
  | { kind: 'item'; n: Notification; id: string };

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { notifications, loading: isLoading, markAllRead } = useNotifications();

  // 通知画面を開いたタイミングで既読化
  useEffect(() => {
    void markAllRead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 通知 → セクション化された Row 配列
  const rows = useMemo<Row[]>(() => {
    const order: Bucket[] = ['今日', '昨日', '1週間以内', 'それ以前'];
    const groups: Record<Bucket, Notification[]> = {
      '今日': [], '昨日': [], '1週間以内': [], 'それ以前': [],
    };
    for (const n of notifications) groups[bucketFor(n.created_at)].push(n);
    const out: Row[] = [];
    for (const b of order) {
      if (groups[b].length === 0) continue;
      out.push({ kind: 'header', bucket: b, id: `h:${b}` });
      for (const n of groups[b]) out.push({ kind: 'item', n, id: n.id });
    }
    return out;
  }, [notifications]);

  if (isLoading && notifications.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <TopBar title="通知" left={<BackButton />} />
        <View>
          {Array.from({ length: 6 }).map((_, i) => (
            <NotificationSkeleton key={`skel-notif-${i}`} />
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
            <Text style={[T.h2, { color: C.text, textAlign: 'center' }]}>通知はまだありません</Text>
            <Text style={[T.body, { color: C.text2, textAlign: 'center', maxWidth: 320 }]}>
              好きなタグの新着、自分の投稿への反応がここに届きます
            </Text>
          </View>

          <PressableScale
            onPress={() => router.push('/settings/notifications' as never)}
            haptic="tap"
            hitSlop={10}
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
      case 'official_post': return '📣';
      default: return '🔔';
    }
  };

  // 通知タップ時 — 関連 surface (タグ feed など) へ遷移する。
  // notifications table に source_id が無いケースが多いので tag_name を最優先で利用。
  // 'official_post' だけは tag_name が「コミュニティ名」なので name→id を runtime ルックアップ。
  const handleTap = async (n: Notification) => {
    if (n.type === 'official_post' && n.tag_name) {
      // 公式コミュニティを name で fetch (LIMIT 1)。見つからなければフォールバック。
      const { data } = await supabase
        .from('communities')
        .select('id')
        .eq('name', n.tag_name)
        .eq('is_official', true)
        .limit(1)
        .maybeSingle();
      if (data?.id) {
        router.push(`/community/${data.id}` as never);
      } else {
        router.push('/(tabs)/corners' as never);
      }
      return;
    }
    if (n.tag_name) {
      router.push(`/tag/${encodeURIComponent(n.tag_name)}` as never);
    } else if (n.type === 'follow') {
      router.push('/(tabs)/mypage' as never);
    } else {
      router.push('/(tabs)/feed' as never);
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
              hitSlop={10}
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
      <FlashList
        data={rows}
        keyExtractor={(r) => r.id}
        estimatedItemSize={90}
        drawDistance={250}
        removeClippedSubviews
        decelerationRate="fast"
        contentContainerStyle={{
          paddingBottom: TABBAR.height + insets.bottom + SP['10'],
        }}
        getItemType={(r) => r.kind}
        renderItem={({ item }) => {
          if (item.kind === 'header') {
            return (
              <View
                style={{
                  paddingHorizontal: SP['4'],
                  paddingTop: SP['4'],
                  paddingBottom: SP['2'],
                  backgroundColor: C.bg,
                }}
              >
                <Text
                  style={[
                    T.smallB,
                    { color: C.text3, letterSpacing: 1.2, fontWeight: '700' },
                  ]}
                >
                  {item.bucket.toUpperCase()}
                </Text>
              </View>
            );
          }
          const n = item.n;
          const isOfficial = n.type === 'official_post';
          return (
            <PressableScale
              onPress={() => void handleTap(n)}
              haptic="tap"
              scaleValue={0.99}
              style={{
                paddingVertical: SP['3'],
                paddingHorizontal: SP['4'],
                backgroundColor: n.read ? C.bg : C.accentBg,
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: SP['3'],
                borderBottomWidth: 1,
                borderBottomColor: C.divider,
                // 公式投稿は左に強いアクセントバーを出して可視性を上げる
                borderLeftWidth: isOfficial ? 3 : 0,
                borderLeftColor: isOfficial ? C.accent : 'transparent',
              }}
            >
              {/* 未読インジケータ */}
              {!n.read && (
                <View style={{
                  position: 'absolute', left: 6, top: '50%',
                  marginTop: -3,
                  width: 6, height: 6, borderRadius: 3,
                  backgroundColor: C.accent,
                }} />
              )}
              {/* type ごとの絵文字 — 公式は常にアクセント色のバッジ */}
              <View style={{
                width: 36, height: 36, borderRadius: 18,
                backgroundColor: isOfficial
                  ? C.accent
                  : (n.read ? C.bg3 : C.accent + '33'),
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Text style={{ fontSize: 18 }}>{typeEmoji(n.type)}</Text>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text
                  style={[
                    T.bodyM,
                    {
                      color: C.text,
                      lineHeight: 20,
                      fontWeight: n.read ? '500' : '700',
                    },
                  ]}
                >
                  {n.message}
                </Text>
                {n.tag_name && (
                  <Text style={[T.small, { color: C.accent }]}>
                    {isOfficial ? n.tag_name : `#${n.tag_name}`}
                  </Text>
                )}
                <Text style={[T.caption, { color: C.text3 }]}>
                  {formatRelative(n.created_at)}
                </Text>
              </View>
            </PressableScale>
          );
        }}
      />
    </View>
  );
}
