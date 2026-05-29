// ============================================================
// マイページ 集約カレンダー
// ------------------------------------------------------------
// 参加コミュニティ全てから upcoming イベントを集める。
// コミュ毎に opt-out 可 (useCalendarHiddenCommunities — local persist)。
//
// パス: /mypage/calendar
// ============================================================

import { View, Text, ScrollView, Modal } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { squareThumbedUrl } from '../../lib/utils/imageUrl';
import { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { BackButton } from '../../components/nav/BackButton';
import { PressableScale } from '../../components/ui/PressableScale';
import { EmptyState } from '../../components/ui/EmptyState';
import { Spinner } from '../../components/ui/Spinner';
import { Icon } from '../../constants/icons';
import { useAuthStore } from '../../stores/authStore';
import {
  fetchMyCommunities,
  fetchMyUpcomingEvents,
  type Community,
} from '../../lib/api/communities';
import { useCalendarHiddenCommunities } from '../../hooks/useCalendarHiddenCommunities';
import { sanitizeUrl } from '../../lib/sanitize';

export default function MyCalendarScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  const { hiddenIds, isHidden, toggle, clear, hidden } = useCalendarHiddenCommunities();
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 参加コミュ (設定モーダルで toggle 用)
  const { data: myCommunities = [] } = useQuery<Community[]>({
    queryKey: ['mypage-my-communities', user?.id],
    queryFn: fetchMyCommunities,
    enabled: !!user,
    staleTime: 60_000,
  });

  // 集約 upcoming イベント — opt-out した community を query key に含めて invalidate 必要
  const { data: events = [], isLoading } = useQuery({
    queryKey: ['mypage-calendar', user?.id, hiddenIds.sort().join(',')],
    queryFn: () => fetchMyUpcomingEvents({ excludeCommunityIds: hiddenIds }),
    enabled: !!user,
    staleTime: 30_000,
  });

  // 月別グルーピング
  const grouped = useMemo(() => {
    const m = new Map<string, typeof events>();
    for (const ev of events) {
      const d = new Date(ev.starts_at);
      if (Number.isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()} 年 ${(d.getMonth() + 1).toString().padStart(2, '0')} 月`;
      const arr = m.get(key) ?? [];
      arr.push(ev);
      m.set(key, arr);
    }
    return Array.from(m.entries());
  }, [events]);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Header */}
      <View
        style={{
          paddingTop: insets.top + SP['2'],
          paddingHorizontal: SP['4'],
          paddingBottom: SP['2'],
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['2'],
          borderBottomWidth: 1,
          borderBottomColor: C.border,
        }}
      >
        <BackButton />
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon.calendar size={18} color={C.text} strokeWidth={2.4} />
          <Text style={[T.h3, { color: C.text }]}>マイカレンダー</Text>
        </View>
        <PressableScale
          onPress={() => setSettingsOpen(true)}
          haptic="tap"
          hitSlop={8}
          accessibilityLabel="カレンダー設定"
          style={{
            padding: 8,
            borderRadius: R.full,
            backgroundColor: hidden.size > 0 ? C.amberBg : C.bg3,
            borderWidth: 1,
            borderColor: hidden.size > 0 ? C.amber + '55' : C.border,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icon.settings size={14} color={hidden.size > 0 ? C.amber : C.text2} strokeWidth={2.4} />
            {hidden.size > 0 && (
              <Text style={{ fontSize: 10, color: C.amber, fontWeight: '700' }}>
                {hidden.size}
              </Text>
            )}
          </View>
        </PressableScale>
      </View>

      {/* Body */}
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: SP['4'],
          paddingVertical: SP['3'],
          gap: SP['3'],
          paddingBottom: insets.bottom + SP['10'],
        }}
      >
        {isLoading ? (
          <View style={{ paddingVertical: SP['10'], alignItems: 'center' }}>
            <Spinner size="large" />
          </View>
        ) : events.length === 0 ? (
          <EmptyState
            icon={Icon.calendar}
            title="直近のイベントがありません"
            message={
              hidden.size > 0
                ? `${hidden.size} コミュニティを非表示にしています`
                : '参加コミュニティのイベントがここに集まります'
            }
            tone="amber"
          />
        ) : (
          grouped.map(([monthLabel, monthEvents]) => (
            <View key={monthLabel} style={{ gap: SP['2'] }}>
              <Text style={[T.smallB, { color: C.text2, marginTop: SP['2'] }]}>
                {monthLabel}
              </Text>
              {monthEvents.map((ev) => (
                <MyCalendarEventRow
                  key={ev.id}
                  event={ev}
                  onPress={() =>
                    router.push(`/community/${ev.community_id}` as never)
                  }
                />
              ))}
            </View>
          ))
        )}
      </ScrollView>

      {/* 設定モーダル */}
      <Modal
        visible={settingsOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setSettingsOpen(false)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
          <View
            style={{
              backgroundColor: C.bg2,
              borderTopLeftRadius: R['2xl'],
              borderTopRightRadius: R['2xl'],
              padding: SP['4'],
              paddingBottom: insets.bottom + SP['4'],
              maxHeight: '80%',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
              <Text style={[T.h3, { color: C.text, flex: 1 }]}>
                カレンダー設定
              </Text>
              <PressableScale
                onPress={() => setSettingsOpen(false)}
                haptic="tap"
                hitSlop={12}
                accessibilityLabel="閉じる"
                style={{ padding: SP['2'] }}
              >
                <Icon.close size={20} color={C.text2} strokeWidth={2.4} />
              </PressableScale>
            </View>
            <Text style={[T.caption, { color: C.text3, marginTop: SP['2'] }]}>
              非表示にしたコミュニティのイベントはカレンダーに出ません
            </Text>

            <ScrollView style={{ marginTop: SP['3'] }} contentContainerStyle={{ gap: SP['2'] }}>
              {myCommunities.length === 0 ? (
                <Text style={[T.body, { color: C.text3, padding: SP['4'], textAlign: 'center' }]}>
                  参加コミュニティがまだありません
                </Text>
              ) : (
                myCommunities.map((c) => {
                  const isVisible = !isHidden(c.id);
                  const safeIconUrl = c.icon_url ? sanitizeUrl(c.icon_url) : null;
                  return (
                    <PressableScale
                      key={c.id}
                      onPress={() => toggle(c.id)}
                      haptic="select"
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: SP['3'],
                        padding: SP['3'],
                        backgroundColor: isVisible ? C.bg3 : C.bg,
                        borderRadius: R.md,
                        borderWidth: 1,
                        borderColor: isVisible ? C.border : C.amber + '55',
                        opacity: isVisible ? 1 : 0.5,
                      }}
                    >
                      <View
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 18,
                          backgroundColor: safeIconUrl ? C.bg3 : c.icon_color,
                          alignItems: 'center',
                          justifyContent: 'center',
                          overflow: 'hidden',
                        }}
                      >
                        {safeIconUrl ? (
                          // 36px @4x = 144 → 160 で retina 余裕。サーバ側 center-crop。
                          <ExpoImage
                            source={{ uri: squareThumbedUrl(safeIconUrl, 160) }}
                            style={{ width: '100%', height: '100%' }}
                            contentFit="cover"
                            cachePolicy="memory-disk"
                            recyclingKey={safeIconUrl}
                            transition={120}
                          />
                        ) : (
                          <Text style={{ fontSize: 20 }}>{c.icon_emoji}</Text>
                        )}
                      </View>
                      <Text style={[T.bodyB, { color: C.text, flex: 1 }]} numberOfLines={1}>
                        {c.name}
                      </Text>
                      <View
                        style={{
                          paddingHorizontal: SP['2'] + 2,
                          paddingVertical: 4,
                          borderRadius: R.full,
                          backgroundColor: isVisible ? C.green + '22' : C.amber + '22',
                          borderWidth: 1,
                          borderColor: isVisible ? C.green + '55' : C.amber + '55',
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 11,
                            color: isVisible ? C.green : C.amber,
                            fontWeight: '700',
                          }}
                        >
                          {isVisible ? '表示中' : '非表示'}
                        </Text>
                      </View>
                    </PressableScale>
                  );
                })
              )}
            </ScrollView>

            {hidden.size > 0 && (
              <PressableScale
                onPress={clear}
                haptic="tap"
                style={{
                  marginTop: SP['3'],
                  paddingVertical: SP['2'],
                  alignItems: 'center',
                  borderRadius: R.md,
                  backgroundColor: C.bg3,
                  borderWidth: 1,
                  borderColor: C.border,
                }}
              >
                <Text style={[T.smallB, { color: C.text2 }]}>
                  全コミュを表示に戻す
                </Text>
              </PressableScale>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ============================================================
// イベント 1 件のロー — community icon + 日付 + タイトル + 場所
// ============================================================
function MyCalendarEventRow({
  event,
  onPress,
}: {
  event: Awaited<ReturnType<typeof fetchMyUpcomingEvents>>[number];
  onPress: () => void;
}) {
  const d = new Date(event.starts_at);
  const valid = !Number.isNaN(d.getTime());
  const day = valid ? d.getDate() : '?';
  const weekday = valid ? ['日', '月', '火', '水', '木', '金', '土'][d.getDay()] ?? '' : '';
  const time = valid
    ? `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
    : '';
  const safeIconUrl = event.community.icon_url ? sanitizeUrl(event.community.icon_url) : null;
  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      style={{
        flexDirection: 'row',
        gap: SP['3'],
        padding: SP['3'],
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
      }}
    >
      {/* 日付ボックス */}
      <View
        style={{
          width: 56,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: C.bg3,
          borderRadius: R.md,
          paddingVertical: SP['2'],
        }}
      >
        <Text style={[T.numLg, { color: C.text }]}>{day}</Text>
        <Text style={[T.caption, { color: C.text3 }]}>{weekday}</Text>
      </View>

      {/* 本体 */}
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View
            style={{
              width: 18,
              height: 18,
              borderRadius: 9,
              backgroundColor: safeIconUrl ? C.bg3 : event.community.icon_color,
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            {safeIconUrl ? (
              // 18px @4x = 72 → 80 で retina 余裕。サーバ側 center-crop。
              <ExpoImage
                source={{ uri: squareThumbedUrl(safeIconUrl, 80) }}
                style={{ width: '100%', height: '100%' }}
                contentFit="cover"
                cachePolicy="memory-disk"
                recyclingKey={safeIconUrl}
                transition={120}
              />
            ) : (
              <Text style={{ fontSize: 10 }}>{event.community.icon_emoji}</Text>
            )}
          </View>
          <Text style={[T.caption, { color: C.text3, flex: 1 }]} numberOfLines={1}>
            {event.community.name}
          </Text>
          <Text style={[T.caption, { color: C.text3 }]}>{time}</Text>
        </View>
        <Text style={[T.bodyB, { color: C.text }]} numberOfLines={2}>
          {event.title}
        </Text>
        {event.location_text && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icon.map size={12} color={C.text3} strokeWidth={2.2} />
            <Text style={[T.small, { color: C.text2 }]} numberOfLines={1}>
              {event.location_text}
            </Text>
          </View>
        )}
      </View>
    </PressableScale>
  );
}
