import { useEffect, useMemo } from 'react';
import { View, Text, ScrollView, Platform } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNotifications } from '../../hooks/useNotifications';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { PressableScale } from '../../components/ui/PressableScale';
import { PolishedButton } from '../../components/ui/PolishedButton';
import { Icon } from '../../constants/icons';
import { C, GRAD, R, SHADOW, SP } from '../../design/tokens';
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

// type → 視覚デザイン (icon / accent color / bg)
// like=pink, comment=blue, follow=accent purple, reply=teal/green,
// event=amber, official_post=accent gradient, default=grey
type NotifVisual = {
  icon: string;
  color: string;
  bgSoft: string;
  borderSoft: string;
};

function visualFor(type: Notification['type']): NotifVisual {
  switch (type) {
    case 'like':
      return { icon: '💛', color: C.pink, bgSoft: C.pinkBg, borderSoft: C.pink + '55' };
    case 'comment':
      return { icon: '💬', color: C.blue, bgSoft: C.blueBg, borderSoft: C.blue + '55' };
    case 'follow':
      return { icon: '👤', color: C.accentLight, bgSoft: C.accentBg, borderSoft: C.accent + '55' };
    case 'reply':
      return { icon: '↩', color: C.green, bgSoft: C.greenBg, borderSoft: C.green + '55' };
    case 'event':
      return { icon: '📅', color: C.amber, bgSoft: C.amberBg, borderSoft: C.amber + '55' };
    case 'official_post':
      return { icon: '📣', color: C.accent, bgSoft: C.accentBg, borderSoft: C.accent };
    default:
      return { icon: '🔔', color: C.text2, bgSoft: C.bg3, borderSoft: C.border };
  }
}

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
          {/* ヒーロー — gradient 96x96 circle + glow */}
          <View style={{ alignItems: 'center', paddingTop: SP['8'], paddingBottom: SP['4'], gap: SP['3'] }}>
            <View style={[
              { borderRadius: 48 },
              SHADOW.glow,
            ]}>
              <LinearGradient
                colors={GRAD.primary}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{
                  width: 96, height: 96, borderRadius: 48,
                  alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Icon.bell size={44} color="#fff" strokeWidth={2.2} />
              </LinearGradient>
            </View>
            <Text style={[T.h2, { color: C.text, textAlign: 'center' }]}>まだ通知がありません</Text>
            <Text style={[T.body, { color: C.text2, textAlign: 'center', maxWidth: 320 }]}>
              好きなタグの新着、自分の投稿への反応がここに届きます
            </Text>
          </View>

          {/* CTA — feed を見に行く / 通知設定 */}
          <View style={{ gap: SP['2'], paddingHorizontal: SP['2'] }}>
            <PolishedButton
              variant="gradient"
              gradient="primary"
              label="フィードを見に行く"
              icon={<Icon.home size={18} color="#fff" strokeWidth={2.2} />}
              onPress={() => router.push('/(tabs)/feed' as never)}
              fullWidth
              haptic="confirm"
            />
            <PressableScale
              onPress={() => router.push('/settings/notifications' as never)}
              haptic="tap"
              hitSlop={10}
              style={{
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
          </View>
        </ScrollView>
      </View>
    );
  }

  const unreadCount = notifications.filter((n) => !n.read).length;

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
            // outline pill: subtle, secondary action ("すべて既読" は破壊的でない)
            <PressableScale
              onPress={() => void markAllRead()}
              haptic="confirm"
              hitSlop={10}
              accessibilityLabel="すべて既読にする"
              accessibilityRole="button"
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: SP['3'],
                paddingVertical: 6,
                backgroundColor: 'transparent',
                borderRadius: R.full,
                borderWidth: 1,
                borderColor: C.accent,
              }}
            >
              <Icon.check size={12} color={C.accentLight} strokeWidth={2.4} />
              <Text style={[T.caption, { color: C.accentLight, fontWeight: '700' }]}>
                すべて既読
              </Text>
            </PressableScale>
          ) : null
        }
      />
      <FlashList
        data={rows}
        keyExtractor={(r) => r.id}
        estimatedItemSize={92}
        drawDistance={250}
        removeClippedSubviews
        decelerationRate="fast"
        contentContainerStyle={{
          paddingTop: SP['2'],
          paddingHorizontal: SP['3'],
          paddingBottom: TABBAR.height + insets.bottom + SP['10'],
        }}
        getItemType={(r) => r.kind}
        renderItem={({ item }) => {
          if (item.kind === 'header') {
            return (
              <View
                style={{
                  paddingTop: SP['4'],
                  paddingBottom: SP['2'],
                  paddingHorizontal: SP['2'],
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
          return (
            <NotificationRow
              n={item.n}
              onPress={() => void handleTap(item.n)}
            />
          );
        }}
      />
    </View>
  );
}

// ============================================================
// NotificationRow — glass-card 風の通知行
// ------------------------------------------------------------
// - 未読: accent subtle bg + accent ドット + bold text + soft glow
// - 既読: bg2 + 普通 text + 透明感少なめ
// - type ごとに icon の色 (like=pink / comment=blue / system=grey 等)
// - 公式投稿は左に accent bar + gradient icon
// ============================================================
function NotificationRow({
  n,
  onPress,
}: {
  n: Notification;
  onPress: () => void;
}) {
  const visual = visualFor(n.type);
  const isOfficial = n.type === 'official_post';
  const unread = !n.read;

  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      scaleValue={0.98}
      accessibilityRole="button"
      accessibilityLabel={n.message}
      style={[
        {
          marginVertical: 4,
          paddingVertical: SP['3'],
          paddingHorizontal: SP['3'],
          backgroundColor: unread ? C.accentBg : C.bg2,
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: SP['3'],
          borderRadius: R.lg,
          borderWidth: 1,
          // 未読は accent border, 既読は subtle border
          borderColor: unread ? C.accent + '40' : C.border,
          // 公式投稿は左に強いアクセントバーを出して可視性を上げる
          borderLeftWidth: isOfficial ? 3 : 1,
          borderLeftColor: isOfficial ? C.accent : (unread ? C.accent + '40' : C.border),
        },
        // Web では subtle hover effect (transition は PressableScale 側が担保)
        Platform.OS === 'web' ? ({ cursor: 'pointer' } as object) : null,
      ]}
    >
      {/* type ごとの icon — 公式は gradient, それ以外は color coded soft bg */}
      {isOfficial ? (
        <View style={[{ borderRadius: 20 }, SHADOW.sm]}>
          <LinearGradient
            colors={GRAD.primary}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              width: 40, height: 40, borderRadius: 20,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 18 }}>{visual.icon}</Text>
          </LinearGradient>
        </View>
      ) : (
        <View style={{
          width: 40, height: 40, borderRadius: 20,
          backgroundColor: visual.bgSoft,
          alignItems: 'center', justifyContent: 'center',
          borderWidth: 1, borderColor: visual.borderSoft,
        }}>
          <Text style={{ fontSize: 18 }}>{visual.icon}</Text>
        </View>
      )}

      {/* メッセージ + タグ + 時間 */}
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: SP['2'] }}>
          <Text
            style={[
              T.bodyM,
              {
                color: C.text,
                lineHeight: 20,
                fontWeight: unread ? '700' : '500',
                flex: 1,
              },
            ]}
          >
            {n.message}
          </Text>
          {/* 未読ドット — 右上に小さく */}
          {unread && (
            <View style={{
              width: 8, height: 8, borderRadius: 4,
              backgroundColor: C.accent,
              marginTop: 6,
            }} />
          )}
        </View>
        {n.tag_name && (
          <Text
            style={[
              T.small,
              {
                color: visual.color,
                fontWeight: '600',
              },
            ]}
          >
            {isOfficial ? n.tag_name : `#${n.tag_name}`}
          </Text>
        )}
        <Text style={[T.caption, { color: C.text3 }]}>
          {formatRelative(n.created_at)}
        </Text>
      </View>
    </PressableScale>
  );
}
