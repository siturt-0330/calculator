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

import { memo, useEffect, useMemo } from 'react';
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
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import {
  PenLine,
  FileText,
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
import { clampHandoff } from '../../design/motion';
import { haptic as triggerHaptic } from '../../lib/haptics';
import { supabase } from '../../lib/supabase';
import { useRecentCommunitiesStore } from '../../stores/recentCommunitiesStore';

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

// ドロワー右エッジの影。translateX で毎フレーム動く本体に大 blur 影が乗ると
// Web は box-shadow を毎フレーム再ラスタライズしてコンポジット負荷が上がるため、
// Web だけ blur 半径を抑える (opacity でコントラストを補償)。native は据置。
const DRAWER_SHADOW =
  Platform.OS === 'web'
    ? { shadowColor: '#000', shadowOffset: { width: 4, height: 0 }, shadowOpacity: 0.4, shadowRadius: 8 }
    : { shadowColor: '#000', shadowOffset: { width: 4, height: 0 }, shadowOpacity: 0.35, shadowRadius: 18, elevation: 12 };

// ============================================================
// HomeDrawer (overlay)
// ============================================================
export const HomeDrawer = memo(function HomeDrawer({
  progress,
  open,
  onOpenChange,
}: {
  /** 0..1 の shared value (closed..open)。feed.tsx と共有。 */
  progress: SharedValue<number>;
  /** コミット済みの開閉 boolean (feed.tsx の drawerOpen)。backdrop の hit 判定に使う。 */
  open: boolean;
  /** open=true/false を JS に通知 (boolean state を反転させたい時用) */
  onOpenChange: (open: boolean) => void;
}) {
  const { width: WW, height: WH } = useWindowDimensions();
  const W = getHomeDrawerWidth(WW);
  const router = useRouter();
  const pathname = usePathname();
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

  // ===== 最近見たコミュニティ (履歴) =====
  // store は sync (MMKV/localStorage) なので mount 時に即 hydrate して履歴を出す。
  const recent = useRecentCommunitiesStore((s) => s.items);
  useEffect(() => {
    useRecentCommunitiesStore.getState().hydrate();
  }, []);

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
          // 指の速度 (px/s) を progress/s に正規化してバネに引き継ぐ → 段付き解消。
          const vNorm = e.velocityX / W;
          const shouldClose =
            e.translationX < -HOME_DRAWER_DIST_THRESHOLD ||
            e.velocityX < -HOME_DRAWER_VEL_THRESHOLD;
          if (shouldClose) {
            // コミット確定時に即 unlock (spring 完了待ちにしない) → 着地フレームの
            // 再 render カクつきを排除。視覚クローズは SharedValue 駆動で滑らかに続く。
            runOnJS(onOpenChange)(false);
            progress.value = withSpring(0, {
              ...HOME_DRAWER_SPRING,
              velocity: clampHandoff(vNorm, 0),
            });
            runOnJS(triggerHaptic)('tap');
          } else {
            // 閾値未満 → 開いたまま戻す。指の速度をそのまま引き継ぐ。
            progress.value = withSpring(1, {
              ...HOME_DRAWER_SPRING,
              velocity: clampHandoff(vNorm, 1),
            });
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

  // backdrop タップで close。スワイプ閉と同じ spring を使って物理感を揃え、
  // 「タップは timing / スワイプは spring」の異種ミックスによる体感の違和感を解消。
  // 初速ゼロでもダンピングが効いた SPRING なら overshoot は気にならない。
  const handleBackdropTap = () => {
    triggerHaptic('tap');
    onOpenChange(false);
    progress.value = withSpring(0, HOME_DRAWER_SPRING);
  };

  // 各 nav action — 閉じアニメをスワイプと同じ spring で即開始し、
  // 同じ画面への navigation はスキップする (drawer 閉アニメに無駄な
  // navigation transition を被せないため = カクつき主因)。
  // 別画面への遷移は rAF で 1tick 退避して push の JS を閉じ初動から外す。
  const navigateAndClose = (path: string) => {
    triggerHaptic('tap');
    onOpenChange(false);
    progress.value = withSpring(0, HOME_DRAWER_SPRING);
    // 同一画面チェック: (tabs) などの group prefix と trailing slash を吸収。
    const norm = (p: string) => p.replace(/\([^)]+\)\//g, '').replace(/\/$/, '');
    if (norm(pathname) === norm(path)) return;
    requestAnimationFrame(() => router.push(path as never));
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
      {/* ===== Backdrop (黒透過 — タップで close) =====
          opacity は backdropStyle (progress 駆動) で滑らかにフェード。hit 判定だけを
          コミット済み open boolean で切替える。旧実装の display:'none'⇄'flex' トグルは
          開き始めの初期状態フラッシュ・閉じ切りの二段消え・Web reflow を生むため廃止。
          closed のときは pointerEvents='none' で backdrop が下の feed タップを奪わない。 */}
      <View
        pointerEvents={open ? 'auto' : 'none'}
        style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
      >
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
      </View>

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
              // 右側に細い影 — 「浮いてる感」を出す (Web は blur 半径を抑えて軽量化)
              ...DRAWER_SHADOW,
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
                icon={FileText}
                label="下書き"
                onPress={() => navigateAndClose('/drafts')}
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

            {/* ===== Section: 最近見たコミュニティ (履歴) ===== */}
            {recent.length > 0 ? (
              <>
                <Divider C={C} />
                <SectionHeader icon={Clock} title="最近見たコミュニティ" C={C} />
                {recent.map((comm) => (
                  <CommunityRow
                    key={comm.id}
                    community={comm}
                    onPress={() => navigateAndClose(`/community/${comm.id}`)}
                    C={C}
                  />
                ))}
              </>
            ) : null}

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

// CommunityRow は admin/joined (CommunityWithRole) と最近見た履歴
// (RecentCommunity) の双方を受けるため、描画に必要な最小フィールドだけを
// 要求する構造的な型にする。
type CommunityRowData = {
  id: string;
  name: string;
  icon_url: string | null;
  icon_emoji: string;
  icon_color: string;
  member_count: number;
};

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
  community: CommunityRowData;
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
