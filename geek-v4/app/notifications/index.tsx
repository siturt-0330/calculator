import { useEffect, useMemo, useRef } from 'react';
import { View, Text, ScrollView, Platform } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withRepeat,
  withSequence,
  Easing,
} from 'react-native-reanimated';
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
import { useColors } from '../../hooks/useColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';

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
// - 未読: accent subtle bg + accent ドット (pulse) + bold text + soft glow
// - 既読: bg2 + 普通 text + 透明感少なめ (250ms で smooth transition)
// - type ごとに icon の色 (like=pink / comment=blue / system=grey 等)
// - 公式投稿は左に accent bar + gradient icon
// - mount 時の entrance: opacity 0→1 + translateX -8→0 (220ms ease-out)
// - reduceMotion 時は即時表示 (pulse / entrance とも skip)
// ============================================================
function NotificationRow({
  n,
  onPress,
}: {
  n: Notification;
  onPress: () => void;
}) {
  const C = useColors();
  const reduceMotion = useReducedMotion();
  const visual = visualFor(n.type);
  const isOfficial = n.type === 'official_post';
  const unread = !n.read;

  // ============================================================
  // Entrance animation — mount 時のみ実行。
  // FlashList の recycler が同じ component instance を別行に流用しても、
  // 「最初の 1 回だけ」になるよう ref で gate する。
  // ============================================================
  const enterOpacity = useSharedValue(reduceMotion ? 1 : 0);
  const enterTx = useSharedValue(reduceMotion ? 0 : -8);
  const didEnterRef = useRef(false);
  useEffect(() => {
    if (didEnterRef.current) return;
    didEnterRef.current = true;
    if (reduceMotion) {
      enterOpacity.value = 1;
      enterTx.value = 0;
      return;
    }
    enterOpacity.value = withTiming(1, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
    });
    enterTx.value = withTiming(0, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
    });
  }, [reduceMotion, enterOpacity, enterTx]);
  const enterStyle = useAnimatedStyle(() => ({
    opacity: enterOpacity.value,
    transform: [{ translateX: enterTx.value }],
  }));

  // ============================================================
  // Read-state crossfade — 既読化された瞬間に bg を 250ms で遷移、
  // dot は 250ms で fade out。reduceMotion 時は即時切替。
  // ============================================================
  const readProgress = useSharedValue(unread ? 0 : 1);
  const dotPulse = useSharedValue(1);
  useEffect(() => {
    if (reduceMotion) {
      readProgress.value = unread ? 0 : 1;
      return;
    }
    readProgress.value = withTiming(unread ? 0 : 1, {
      duration: 250,
      easing: Easing.out(Easing.quad),
    });
  }, [unread, reduceMotion, readProgress]);

  // 未読ドットの pulse animation — 1 → 1.15 → 1 を 1600ms loop
  useEffect(() => {
    if (reduceMotion) {
      dotPulse.value = 1;
      return;
    }
    if (unread) {
      dotPulse.value = withRepeat(
        withSequence(
          withTiming(1.15, { duration: 800, easing: Easing.inOut(Easing.quad) }),
          withTiming(1, { duration: 800, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
      );
    } else {
      dotPulse.value = withTiming(1, { duration: 200 });
    }
  }, [unread, reduceMotion, dotPulse]);

  // bg / border は read 状態によって異なる。Animated で表現するため、
  // 2 層 (unread layer + read layer) を重ねて opacity で crossfade する。
  const unreadLayerStyle = useAnimatedStyle(() => ({
    opacity: 1 - readProgress.value,
  }));
  const readLayerStyle = useAnimatedStyle(() => ({
    opacity: readProgress.value,
  }));
  const dotStyle = useAnimatedStyle(() => ({
    // dot は未読中だけ可視 (= readProgress 0)。read に切り替わると fade out。
    opacity: 1 - readProgress.value,
    transform: [{ scale: dotPulse.value }],
  }));

  return (
    <Animated.View style={enterStyle}>
      <PressableScale
        onPress={onPress}
        haptic="tap"
        scaleValue={0.97}
        accessibilityRole="button"
        accessibilityLabel={n.message}
        accessibilityState={{ selected: unread }}
        style={[
          {
            marginVertical: 4,
            paddingVertical: SP['3'],
            paddingHorizontal: SP['3'],
            backgroundColor: C.bg2,
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: SP['3'],
            borderRadius: R.lg,
            borderWidth: 1,
            borderColor: C.border,
            // 公式投稿は左に強いアクセントバーを出して可視性を上げる
            borderLeftWidth: isOfficial ? 3 : 1,
            borderLeftColor: isOfficial ? C.accent : C.border,
            overflow: 'hidden',
            position: 'relative',
          },
          // Web では subtle hover effect (transition は PressableScale 側が担保)
          Platform.OS === 'web' ? ({ cursor: 'pointer' } as object) : null,
        ]}
      >
        {/* 未読 overlay layer — accent bg + accent border を fade で重ねる */}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: C.accentBg,
              borderRadius: R.lg,
              borderWidth: 1,
              borderColor: C.accent + '40',
              borderLeftWidth: isOfficial ? 3 : 1,
              borderLeftColor: isOfficial ? C.accent : C.accent + '40',
            },
            unreadLayerStyle,
          ]}
        />
        {/* read 状態用の subtle border を維持するための placeholder
            (実際の bg は親 View が担っているので opacity 制御だけで十分) */}
        <Animated.View
          pointerEvents="none"
          style={[
            { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
            readLayerStyle,
          ]}
        />

        {/* type ごとの icon — 公式は gradient, それ以外は themed soft bg */}
        {isOfficial ? (
          <View style={[{ borderRadius: 10 }, SHADOW.sm]}>
            <LinearGradient
              colors={GRAD.primary}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                width: 40, height: 40, borderRadius: 10,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: 18 }}>{visual.icon}</Text>
            </LinearGradient>
          </View>
        ) : (
          <View style={{
            width: 40, height: 40, borderRadius: 10,
            backgroundColor: C.bg3,
            alignItems: 'center', justifyContent: 'center',
            borderWidth: 1, borderColor: C.border,
          }}>
            <Text style={{ fontSize: 18 }}>{visual.icon}</Text>
          </View>
        )}

        {/* メッセージ + タグ */}
        <View style={{ flex: 1, gap: 3 }}>
          <Text
            style={[
              T.body,
              {
                color: C.text,
                lineHeight: 20,
                fontWeight: unread ? '700' : '500',
              },
            ]}
          >
            {n.message}
          </Text>
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
        </View>

        {/* 右側カラム: ドット + 時刻 (右揃え) */}
        <View style={{ alignItems: 'flex-end', gap: 4, minWidth: 48 }}>
          <Animated.View
            style={[
              {
                width: 8, height: 8, borderRadius: 4,
                backgroundColor: C.accent,
              },
              dotStyle,
            ]}
          />
          <Text style={[T.caption, { color: C.text3, textAlign: 'right' }]}>
            {formatRelative(n.created_at)}
          </Text>
        </View>
      </PressableScale>
    </Animated.View>
  );
}
