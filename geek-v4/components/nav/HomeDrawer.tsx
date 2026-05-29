// ============================================================
// HomeDrawer — X (Twitter) 風の左ドロワー (ホームタブ専用)
// ------------------------------------------------------------
// 仕様:
//   - 幅 = window.width * 0.80
//   - 右スワイプ (画面左端 24pt 以内から) で open
//   - 左スワイプ (drawer 上の任意位置から) で close
//   - 速度 > 500 または距離 > 80pt で commit、それ未満は spring で戻す
//   - drawer: translateX(-W → 0)、feed: translateX(0 → W)、backdrop: opacity(0 → 0.5)
//   - spring: damping 26, stiffness 280, mass 0.8
//   - 60fps 維持 (worklet 内のみ計算、runOnJS は open/close 通知だけ)
//   - 開いたら scroll を lock するため pointerEvents="auto" の backdrop で
//     feed タップを吸収しつつ「右側の見える feed」で close を発火
//
// 構造:
//   <HomeDrawer
//     progress={shared}      // 0..1 (closed..open) — feed.tsx で同 SV を共有
//     onClose={() => ...}    // close 完了を JS に伝える
//   />
//   ※ swipe gesture は feed.tsx 側で GestureDetector を組む (root を wrap する都合)。
//     HomeDrawer 自身は backdrop タップ / 内部 swipe gesture / コンテンツ描画を担当。
// ============================================================

import { memo, useMemo, type ComponentType } from 'react';
import {
  View,
  Text,
  ScrollView,
  Platform,
  Pressable,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import {
  PenLine,
  UserPlus2,
  Clock,
  User as UserIcon,
  Bookmark,
  Settings as SettingsIcon,
  HelpCircle,
  UserCog,
  Crown,
  Users,
  type LucideIcon,
} from 'lucide-react-native';
import { Avatar } from '../ui/Avatar';
import { PressableScale } from '../ui/PressableScale';
import { useAuthStore } from '../../stores/authStore';
import { useMyFriends } from '../../hooks/useFriends';
import { useAdminCommunities } from '../../hooks/useAdminCommunities';
import { useTheme } from '../../hooks/useColors';
import type { ColorPalette } from '../../lib/theme/palettes';
import { R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { haptic as triggerHaptic } from '../../lib/haptics';
import { supabase } from '../../lib/supabase';
import type { CommunityWithRole } from '../../lib/api/communities';

// spring 設定 (仕様書通り)
export const HOME_DRAWER_SPRING = {
  damping: 26,
  stiffness: 280,
  mass: 0.8,
} as const;

// drawer 幅は window.width の 80%
export function getHomeDrawerWidth(windowWidth: number): number {
  return Math.round(windowWidth * 0.8);
}

// commit 判定: |translation| > 80 または |velocity| > 500
export const HOME_DRAWER_DIST_THRESHOLD = 80;
export const HOME_DRAWER_VEL_THRESHOLD = 500;
// 画面左端からの "open swipe" を受け付ける幅 (24pt)
export const HOME_DRAWER_EDGE_GRAB = 24;

// ============================================================
// HomeDrawer (overlay)
// ============================================================
export const HomeDrawer = memo(function HomeDrawer({
  progress,
  onOpenChange,
}: {
  /** 0..1 の shared value (closed..open)。feed.tsx と共有。 */
  progress: SharedValue<number>;
  /** open=true/false を JS に通知 (boolean state を反転させたい時用) */
  onOpenChange: (open: boolean) => void;
}) {
  const { width: WW, height: WH } = useWindowDimensions();
  const W = getHomeDrawerWidth(WW);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { C, GRAD } = useTheme();

  // ===== 自分のプロフィール (mypage-stats と同じ key/query を共有) =====
  // feed.tsx の idle prefetch でも温められるため drawer open 時は即 cache hit する。
  const userId = useAuthStore((s) => s.user?.id);
  const fallbackNickname = useAuthStore((s) => s.user?.nickname);
  const { data: stats } = useQuery({
    queryKey: ['mypage-stats', userId],
    queryFn: async () => {
      if (!userId) return null;
      const { data } = await supabase
        .from('profiles')
        .select('post_count, like_received_count, comment_count, concern_received_count, created_at, nickname, avatar_emoji, avatar_url')
        .eq('id', userId)
        .single();
      return data as {
        post_count: number;
        like_received_count: number;
        comment_count: number;
        concern_received_count: number;
        created_at: string | null;
        nickname: string | null;
        avatar_emoji: string | null;
        avatar_url: string | null;
      } | null;
    },
    enabled: !!userId,
    staleTime: 60_000,
  });

  const nickname = stats?.nickname ?? fallbackNickname ?? 'ユーザー';
  // handle 用 — 専用 column が無いので nickname を流用 ("@nickname")
  const handle = `@${nickname}`;

  // ===== 友達数 (cache 済 if user opened mypage 前に) =====
  const { friends } = useMyFriends();
  const friendCount = friends.length;

  // ===== コミュニティ (role 別) =====
  const { admin, joined } = useAdminCommunities();

  // ----- スワイプ to close (左方向) -----
  // drawer 内部から左スワイプで閉じる。feed.tsx 側の open swipe とは別 gesture。
  // simultaneousWithExternalGesture を組まないので、ScrollView 内部の垂直 scroll とは
  // activeOffsetX で住み分け (水平 10pt 以上動いて初めて active)。
  const closeGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-10, 10])
        .failOffsetY([-12, 12])
        .onChange((e) => {
          'worklet';
          // 左へのドラッグだけ追従。右ドラッグは無視 (もう全開状態なので)
          const dx = Math.min(0, e.translationX);
          const next = 1 + dx / W; // 0 で closed
          progress.value = Math.max(0, Math.min(1, next));
        })
        .onEnd((e) => {
          'worklet';
          const shouldClose =
            e.translationX < -HOME_DRAWER_DIST_THRESHOLD ||
            e.velocityX < -HOME_DRAWER_VEL_THRESHOLD;
          if (shouldClose) {
            progress.value = withSpring(0, HOME_DRAWER_SPRING, (fin) => {
              if (fin) runOnJS(onOpenChange)(false);
            });
            runOnJS(triggerHaptic)('tap');
          } else {
            progress.value = withSpring(1, HOME_DRAWER_SPRING);
          }
        }),
    [W, progress, onOpenChange],
  );

  // ----- 各 animated style -----
  const drawerStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(
          progress.value,
          [0, 1],
          [-W, 0],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0, 0.5], Extrapolation.CLAMP),
  }));

  // pointerEvents の切替 — closed のときは drawer / backdrop の hit を全部遮断
  // (translateX:-W で見えなくても touchable は残るので明示 none にする)
  const pointerEvents = useDerivedValue(() => (progress.value > 0.01 ? 'auto' : 'none'));

  // backdrop タップで close (right-side 可視 feed タップ相当)
  const handleBackdropTap = () => {
    triggerHaptic('tap');
    progress.value = withSpring(0, HOME_DRAWER_SPRING, (fin) => {
      'worklet';
      if (fin) runOnJS(onOpenChange)(false);
    });
  };

  // 各 nav action — router.push と「閉じる」を同時に
  const navigateAndClose = (path: string) => {
    triggerHaptic('tap');
    progress.value = withSpring(0, HOME_DRAWER_SPRING);
    onOpenChange(false);
    router.push(path as never);
  };

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        zIndex: 1000,
      }}
    >
      {/* ===== Backdrop (黒透過 — タップで close) ===== */}
      <AnimatedPointerView pointerEvents={pointerEvents}>
        <Animated.View
          style={[
            {
              position: 'absolute',
              left: 0,
              top: 0,
              right: 0,
              bottom: 0,
              backgroundColor: '#000',
            },
            backdropStyle,
          ]}
        >
          {/* Pressable 直下に置くと a11y ツリーで「閉じる」と読まれる */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="ドロワーを閉じる"
            onPress={handleBackdropTap}
            style={{ flex: 1 }}
          />
        </Animated.View>
      </AnimatedPointerView>

      {/* ===== Drawer ===== */}
      <GestureDetector gesture={closeGesture}>
        <Animated.View
          accessibilityRole="menu"
          accessibilityState={{ expanded: true }}
          style={[
            {
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: W,
              backgroundColor: C.bg2,
              borderRightWidth: 1,
              borderRightColor: C.divider,
              // 右側に細い影 — 「浮いてる感」を出す
              shadowColor: '#000',
              shadowOffset: { width: 4, height: 0 },
              shadowOpacity: 0.35,
              shadowRadius: 18,
              elevation: 12,
            },
            drawerStyle,
          ]}
        >
          {/* 背景に subtle gradient (header の brand 感) */}
          <LinearGradient
            colors={[C.bg2, C.bg]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 0.6 }}
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: 0,
              bottom: 0,
            }}
          />
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{
              paddingTop: insets.top + SP['3'],
              paddingBottom: insets.bottom + SP['8'],
            }}
            showsVerticalScrollIndicator={false}
          >
            {/* ===== Header (avatar + name + handle + counts + edit) ===== */}
            <View style={{ paddingHorizontal: SP['4'], paddingBottom: SP['4'] }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                }}
              >
                <Avatar
                  size={56}
                  uri={stats?.avatar_url ?? undefined}
                  emoji={stats?.avatar_emoji ?? undefined}
                  name={nickname}
                  ring="accent"
                />
                <PressableScale
                  onPress={() => navigateAndClose('/settings/profile-edit')}
                  haptic="tap"
                  hitSlop={10}
                  accessibilityLabel="プロフィールを編集"
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: R.full,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: C.glass,
                    borderWidth: 1,
                    borderColor: C.glassBorder,
                  }}
                >
                  <UserCog size={18} color={C.text} strokeWidth={2.2} />
                </PressableScale>
              </View>

              <View style={{ marginTop: SP['3'] }}>
                <Text style={[T.h4, { color: C.text }]} numberOfLines={1}>
                  {nickname}
                </Text>
                <Text style={[T.small, { color: C.text3, marginTop: 2 }]} numberOfLines={1}>
                  {handle}
                </Text>
              </View>

              {/* フォロー数 — 「フォロー」概念が無いので friends を表示 */}
              <View
                style={{
                  flexDirection: 'row',
                  marginTop: SP['3'],
                  gap: SP['4'],
                }}
              >
                <CountChip count={friendCount} label="友達" />
                <CountChip count={stats?.post_count ?? 0} label="投稿" />
              </View>
            </View>

            <Divider C={C} />

            {/* ===== Section 1: action items ===== */}
            <View style={{ paddingVertical: SP['2'] }}>
              <DrawerAction
                icon={PenLine}
                label="投稿をする"
                onPress={() => navigateAndClose('/post/create')}
                C={C}
              />
              <DrawerAction
                icon={UserPlus2}
                label="コミュニティを作る"
                onPress={() => navigateAndClose('/community/create')}
                C={C}
              />
              <DrawerAction
                icon={Clock}
                label="いいねした投稿"
                onPress={() => navigateAndClose('/mypage/liked')}
                C={C}
              />
              <DrawerAction
                icon={UserIcon}
                label="マイプロフィール"
                onPress={() => navigateAndClose('/mypage')}
                C={C}
              />
              <DrawerAction
                icon={Bookmark}
                label="保存済み"
                onPress={() => navigateAndClose('/mypage/saved')}
                C={C}
              />
            </View>

            {/* ===== Section 2: admin コミュニティ ===== */}
            {admin.length > 0 ? (
              <>
                <Divider C={C} />
                <SectionHeader icon={Crown} title="管理コミュニティ" C={C} />
                {admin.map((comm) => (
                  <CommunityRow
                    key={comm.id}
                    community={comm}
                    onPress={() => navigateAndClose(`/community/${comm.id}`)}
                    C={C}
                  />
                ))}
              </>
            ) : null}

            {/* ===== Section 3: 参加コミュニティ ===== */}
            {joined.length > 0 ? (
              <>
                <Divider C={C} />
                <SectionHeader icon={Users} title="参加中のコミュニティ" C={C} />
                {joined.map((comm) => (
                  <CommunityRow
                    key={comm.id}
                    community={comm}
                    onPress={() => navigateAndClose(`/community/${comm.id}`)}
                    C={C}
                  />
                ))}
              </>
            ) : null}

            {/* ===== Footer: 設定 / ヘルプ ===== */}
            <Divider C={C} />
            <View style={{ paddingVertical: SP['2'] }}>
              <DrawerAction
                icon={SettingsIcon}
                label="設定"
                onPress={() => navigateAndClose('/settings')}
                C={C}
              />
              <DrawerAction
                icon={HelpCircle}
                label="ヘルプ"
                onPress={() => navigateAndClose('/settings/help')}
                C={C}
              />
            </View>

            {/* 下端 brand spacer — gradient で nebula 感を */}
            <LinearGradient
              colors={GRAD.glass}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              pointerEvents="none"
              style={{
                marginTop: SP['4'],
                marginHorizontal: SP['4'],
                height: 1,
                borderRadius: 1,
              }}
            />
            {Platform.OS !== 'web' && WH > 0 ? null : null}
          </ScrollView>
        </Animated.View>
      </GestureDetector>
    </View>
  );
});

// ============================================================
// 小ヘルパー (色を受け取って描画 — useTheme 多重 subscribe を避ける)
// ============================================================
type PaletteLike = ColorPalette;

function CountChip({ count, label }: { count: number; label: string }) {
  const { C } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: SP['1'] }}>
      <Text style={[T.bodyB, { color: C.text }]}>{count.toLocaleString()}</Text>
      <Text style={[T.small, { color: C.text3 }]}>{label}</Text>
    </View>
  );
}

function Divider({ C }: { C: PaletteLike }) {
  return (
    <View
      style={{
        height: 1,
        backgroundColor: C.divider,
        marginHorizontal: SP['4'],
      }}
    />
  );
}

function SectionHeader({
  icon: Icon,
  title,
  C,
}: {
  icon: LucideIcon;
  title: string;
  C: PaletteLike;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: SP['4'],
        paddingTop: SP['4'],
        paddingBottom: SP['2'],
        gap: SP['2'],
      }}
    >
      <Icon size={14} color={C.text3} strokeWidth={2.2} />
      <Text
        style={[
          T.captionM,
          {
            color: C.text3,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
          },
        ]}
      >
        {title}
      </Text>
    </View>
  );
}

function DrawerAction({
  icon: Icon,
  label,
  onPress,
  C,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  C: PaletteLike;
}) {
  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      accessibilityRole="menuitem"
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: SP['4'],
        height: 52,
        gap: SP['3'],
      }}
    >
      <Icon size={22} color={C.text} strokeWidth={1.8} />
      <Text style={[T.body, { color: C.text, fontSize: 16, flex: 1 }]} numberOfLines={1}>
        {label}
      </Text>
    </PressableScale>
  );
}

function CommunityRow({
  community,
  onPress,
  C,
}: {
  community: CommunityWithRole;
  onPress: () => void;
  C: PaletteLike;
}) {
  // icon: avatar uri があればそれ、無ければ emoji (Avatar component が両対応)
  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      accessibilityRole="menuitem"
      accessibilityLabel={`コミュニティ ${community.name}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: SP['4'],
        paddingVertical: SP['2'],
        gap: SP['3'],
      }}
    >
      <Avatar
        size={36}
        uri={community.icon_url ?? undefined}
        emoji={community.icon_emoji}
        color={community.icon_color}
        name={community.name}
      />
      <View style={{ flex: 1 }}>
        <Text style={[T.bodyM, { color: C.text }]} numberOfLines={1}>
          {community.name}
        </Text>
        {community.member_count > 0 ? (
          <Text style={[T.caption, { color: C.text3 }]} numberOfLines={1}>
            {community.member_count.toLocaleString()} メンバー
          </Text>
        ) : null}
      </View>
    </PressableScale>
  );
}

// ============================================================
// AnimatedPointerView — `pointerEvents` を shared value から制御するための薄い wrapper
// ------------------------------------------------------------
// react-native の pointerEvents は string only (animated bridge 経由で動的変更
// するには Animated.View に pointerEvents prop を直接渡す必要がある)。
// 「closed なら none / それ以外 auto」を毎 frame ではなく
// `useDerivedValue` で計算した string を View 全体に切替えるラッパ。
// ============================================================
const AnimatedView = Animated.View as ComponentType<
  React.ComponentProps<typeof Animated.View>
>;

function AnimatedPointerView({
  pointerEvents,
  children,
}: {
  pointerEvents: SharedValue<'auto' | 'none'>;
  children: React.ReactNode;
}) {
  // shared value → JS prop へは AnimatedProps で接続する正攻法もあるが、
  // pointerEvents は文字列 4 値の離散なので useAnimatedStyle 内で `display`
  // を切り替える形に倒した方が確実。ここでは progress=0 のときに hit を絶対
  // 通したくないので display:'none' で View ごと取り除く。
  const style = useAnimatedStyle(() => ({
    display: pointerEvents.value === 'none' ? 'none' : 'flex',
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
  }));
  return <AnimatedView style={style}>{children}</AnimatedView>;
}
