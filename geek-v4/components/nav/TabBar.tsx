import { View, Platform, Pressable, useWindowDimensions } from 'react-native';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedReaction,
  withSpring,
  withSequence,
  withTiming,
  interpolate,
  useReducedMotion,
  Extrapolation,
  runOnJS,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, usePathname } from 'expo-router';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { TabIcon, type TabKey } from './TabIcon';
import { HapticTab } from './HapticTab';
import { useResolvedTheme } from '../../lib/theme/themeStore';
import { useTheme } from '../../hooks/useColors';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';
import { SPRING_LIQUID, SPRING_LIQUID_FAST, EASE_OUT } from '../../design/motion';
import { hap } from '../../design/haptics';
import { useTabBarScrollSV } from '../../lib/contexts/tabBarScroll';

// ============================================================
// Liquid Glass TabBar v5 (2026-06-12) — transform-only morph
// ------------------------------------------------------------
// v4 までの「pill の left/width を毎フレーム補間」は **レイアウトプロパティの
// アニメーション** で、web/native とも毎フレーム re-layout が走りカクつきの
// 根本原因だった (深掘りリサーチの結論: 『translateX/scale/opacity のみ動かし、
// width/left/margin は絶対に触らない』)。
//
// v5 はこれを根治する 2 レイヤー構成:
//   - Layer A「pill バー」: 常に展開サイズで固定レイアウト。収縮時は
//     translateY (下へ沈む) + scale 0.94 + opacity 0 で退場。
//   - Layer B「ball」: 左下 60×60 固定レイアウト。収縮時に
//     translateY (浮き上がる) + scale 0.5→1 + opacity で登場。
//   → アニメは transform + opacity だけ = GPU 合成のみ・レイアウト再計算ゼロ。
//     iOS の BlurView もサイズ固定になり毎フレームの blur 再計算が消える。
//
// 体験 (v4 から継承):
//   - ガラス素材 (iOS=BlurView / web=半透明bg のみ※ / Android=不透明)
//     ※ web の backdrop-filter は transform 中の再サンプリングで重いため不使用
//   - 透明 indicator chip + accent 紫アイコン (ピンク紫グラデ廃止)
//   - 下スクロール=ball 化 / 上スクロール=どの位置でも即 pill 復帰
//     (展開 SPRING_LIQUID_FAST 180ms / 収縮 SPRING_LIQUID 300ms の非対称)
//   - ball tap = 展開 + active タブの tabPress emit (scroll-to-top 同時発火)
//   - 投稿 + FAB は右下に常時表示
//   - mount 時スライドイン / active 再タップ wiggle / reduce-motion 対応
// ============================================================

const ROUTE_TO_TAB: Record<string, TabKey> = {
  feed: 'home',
  search: 'search',
  community: 'community',
  mypage: 'mypage',
};

// ---- 形状パラメータ ----------------------------------------
const PILL_HEIGHT = 60;
const PILL_RADIUS = 30; // = PILL_HEIGHT / 2 で full pill
const PILL_MARGIN_H = 20;
const PILL_MARGIN_B = 12; // safe-area inset に加算
const PILL_PADDING_H = 6;
const ICON_SIZE = 24;

// 投稿追加 FAB (pill 右隣・常時表示)
const FAB_SIZE = 60;
const FAB_GAP = 10;

// ball (収縮状態) — 左下固定の正円
const BALL_SIZE = 60;
const BALL_EDGE_INSET = 16; // Reddit 流: 左下

// sliding indicator — full capsule (高さの半分 = radius)
const INDICATOR_PAD_V = 6;
const INDICATOR_H = PILL_HEIGHT - INDICATOR_PAD_V * 2; // 48
const INDICATOR_RADIUS = INDICATOR_H / 2; // 24 = capsule
const INDICATOR_INSET_H = 5;

// jelly squash (indicator スライド中の液体感)
const STRETCH_PEAK = 1.12;
const STRETCH_UP_MS = 120;
const STRETCH_DOWN_MS = 200;
const STRETCH_Y_RATIO = 0.55;

// morph の振り付け (transform-only)
const PILL_EXIT_Y = 72; // pill が下へ沈む距離
const PILL_EXIT_SCALE = 0.94;
const BALL_ENTER_Y = 16; // ball が浮き上がる距離
const BALL_ENTER_SCALE = 0.5;

// scroll 方向判定
const TOP_GUARD = 24; // scrollY がこれ未満なら常に expand
const SCROLL_NOISE = 3; // これ未満の dy は方向判定しない

// 登場アニメ
const ENTER_OFFSET = 18;

// 現在のルートが「コミュニティ詳細」配下なら community_id を抽出する。
function extractCommunityIdFromPath(pathname: string): string | undefined {
  const m = pathname.match(/^\/community\/([^/?#]+)(?:[/?#]|$)/);
  return m && m[1] ? decodeURIComponent(m[1]) : undefined;
}

type CellLayout = { x: number; width: number };

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const theme = useResolvedTheme();
  const { C } = useTheme();
  const isDark = theme === 'dark';
  const reduceMotion = useReducedMotion();
  const { width: winW } = useWindowDimensions();
  const scrollSV = useTabBarScrollSV();

  // ---- ガラス素材 (pill / ball は別レイヤーなので静的色で持つ) ----
  // ガラスの作り分け (v5.1 / 2026-06-12):
  //   iOS    = BlurView (本物の backdrop blur)。透過度高め。
  //   Web    = ★backdrop-filter は使わない★。transform で動く面に
  //            backdrop-filter が同居すると毎フレーム背景を再サンプリングして
  //            morph がカクつく [v5 レビュー確証 high / 既出: ProfileMastheadV2 ・
  //            MypageStickyBar に同趣旨の対策コメントあり]。
  //            半透明 bg (+sheen+border) だけで「素通しの透明感」を出す。
  //   Android= blur なし・不透明寄り (視認性優先)。
  const pillBg =
    Platform.OS === 'ios'
      ? isDark
        ? 'rgba(22,22,26,0.72)'
        : 'rgba(255,255,255,0.68)'
      : Platform.OS === 'web'
        ? isDark
          ? 'rgba(20,20,24,0.84)'
          : 'rgba(255,255,255,0.86)'
        : isDark
          ? 'rgba(20,20,22,0.96)'
          : 'rgba(255,255,255,0.97)';
  // ball — dark で背景 #0a0a0a に溶けないよう若干濃く (透明感は維持)
  const ballBg =
    Platform.OS === 'ios'
      ? isDark
        ? 'rgba(34,34,40,0.88)'
        : 'rgba(255,255,255,0.78)'
      : Platform.OS === 'web'
        ? isDark
          ? 'rgba(36,36,42,0.92)'
          : 'rgba(255,255,255,0.92)'
        : isDark
          ? 'rgba(28,28,32,0.98)'
          : 'rgba(255,255,255,0.99)';
  // border — design system C.glassBorder (16%) と整合。ball はさらに強く
  const pillBorder = isDark ? 'rgba(255,255,255,0.14)' : 'rgba(15,23,42,0.16)';
  const ballBorder = isDark ? 'rgba(255,255,255,0.22)' : 'rgba(15,23,42,0.22)';
  // specular highlight (上端の光)
  const sheenColor = isDark ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.55)';
  // active indicator — 落ち着いた透明 chip
  const indicatorTint = isDark ? 'rgba(255,255,255,0.16)' : 'rgba(15,23,42,0.07)';

  const shadowStyle = {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: isDark ? 0.45 : 0.14,
    shadowRadius: 24,
    elevation: 12,
  };
  // ball は背景から浮かせるため影を深めに
  const ballShadowStyle = {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: isDark ? 0.6 : 0.22,
    shadowRadius: 20,
    elevation: 14,
  };

  // web は boxShadow のみ。backdrop-filter は意図的に載せない —
  // transform アニメ中の再サンプリングで morph がカクつくため (上の素材コメント参照)。
  const webExtra =
    Platform.OS === 'web'
      ? ({
          boxShadow: isDark
            ? '0 8px 28px rgba(0,0,0,0.45)'
            : '0 8px 28px rgba(148,163,184,0.32)',
        } as Record<string, unknown>)
      : null;

  // ---- 寸法 (両レイヤーとも固定レイアウト — 補間しない) ----
  const EXPANDED_LEFT = PILL_MARGIN_H;
  const EXPANDED_WIDTH = Math.max(120, winW - PILL_MARGIN_H * 2 - FAB_GAP - FAB_SIZE);
  const FAB_LEFT = EXPANDED_LEFT + EXPANDED_WIDTH + FAB_GAP;
  const bottom = insets.bottom + PILL_MARGIN_B;

  // ============================================================
  // 登場アニメ — mount 時に下からスライドイン + フェード
  // ============================================================
  const entrance = useSharedValue(0);
  useEffect(() => {
    entrance.value = reduceMotion ? 1 : withSpring(1, { duration: 600, dampingRatio: 0.8 });
  }, [entrance, reduceMotion]);

  const entranceStyle = useAnimatedStyle(() => ({
    opacity: entrance.value,
    transform: [{ translateY: (1 - entrance.value) * ENTER_OFFSET }],
  }));

  // ============================================================
  // pill ⇄ ball morph — スクロール方向で 0/1 に振る
  // ============================================================
  const shrink = useSharedValue(0);
  const shrinkTarget = useSharedValue(0);
  const [collapsed, setCollapsed] = useState(false);

  // タブ切替時は scrollY をリセット → 下の reaction で expand 方向に倒れる
  useEffect(() => {
    if (scrollSV) scrollSV.value = 0;
  }, [state.index, scrollSV]);

  useAnimatedReaction(
    () => scrollSV?.value ?? 0,
    (current, previous) => {
      if (reduceMotion) {
        shrinkTarget.value = 0;
        shrink.value = 0;
        return;
      }
      if (previous === null) return;
      let desired: number | null = null;
      if (current < TOP_GUARD) {
        desired = 0;
      } else {
        const dy = current - previous;
        if (Math.abs(dy) < SCROLL_NOISE) return;
        desired = dy > 0 ? 1 : 0;
      }
      if (desired !== null && shrinkTarget.value !== desired) {
        shrinkTarget.value = desired;
        // 展開 (→0) は FAST、収縮 (→1) は通常 — 非対称 spring
        shrink.value = withSpring(
          desired,
          desired === 0 ? SPRING_LIQUID_FAST : SPRING_LIQUID,
        );
      }
    },
    [reduceMotion],
  );

  // collapsed 状態 (JS 側) — pointerEvents / a11y の切替用
  useAnimatedReaction(
    () => shrink.value > 0.5,
    (isBall, prev) => {
      if (isBall !== prev) runOnJS(setCollapsed)(isBall);
    },
    [],
  );

  // active route 参照 (expandBar / ball アイコン用)
  const activeRoute = state.routes[state.index];
  const activeTabKey = activeRoute ? ROUTE_TO_TAB[activeRoute.name] : undefined;

  // ボール tap → pill へ展開 + active タブの tabPress を同時 emit。
  // tabPress は useScrollToTop が listen → 「展開 + scroll-to-top」1 ジェスチャ。
  const expandBar = useCallback(() => {
    hap.tap();
    shrinkTarget.value = 0;
    shrink.value = withSpring(0, SPRING_LIQUID_FAST);
    if (activeRoute) {
      navigation.emit({
        type: 'tabPress',
        target: activeRoute.key,
        canPreventDefault: true,
      });
    }
  }, [shrink, shrinkTarget, activeRoute, navigation]);

  // ============================================================
  // sliding indicator — cell 計測 + spring スライド + jelly squash
  // ============================================================
  const [cells, setCells] = useState<CellLayout[]>([]);
  const tx = useSharedValue(0);
  const stretch = useSharedValue(1);
  const positionedRef = useRef(false);
  const prevIndexRef = useRef<number | null>(null);

  const onCellLayout = useCallback((index: number, x: number, width: number) => {
    setCells((prev) => {
      const cur = prev[index];
      if (cur && cur.x === x && cur.width === width) return prev;
      const next = prev.slice();
      next[index] = { x, width };
      return next;
    });
  }, []);

  // active tab 再タップの wiggle シグナル (tab key → counter)
  const [wiggles, setWiggles] = useState<Record<string, number>>({});

  const activeIndex = state.index;
  const activeCell = cells[activeIndex];

  useEffect(() => {
    const cell = cells[activeIndex];
    if (!cell) return;
    const targetX = cell.x + INDICATOR_INSET_H;
    const indexChanged =
      prevIndexRef.current !== null && prevIndexRef.current !== activeIndex;
    prevIndexRef.current = activeIndex;

    if (!positionedRef.current || reduceMotion || !indexChanged) {
      positionedRef.current = true;
      tx.value = targetX;
      return;
    }
    tx.value = withSpring(targetX, SPRING_LIQUID);
    stretch.value = withSequence(
      withTiming(STRETCH_PEAK, { duration: STRETCH_UP_MS, easing: EASE_OUT }),
      withTiming(1, { duration: STRETCH_DOWN_MS, easing: EASE_OUT }),
    );
  }, [activeIndex, cells, reduceMotion, tx, stretch]);

  // ============================================================
  // animated styles — すべて transform + opacity のみ (GPU 合成限定)
  // ============================================================
  // indicator: translateX スライド + jelly squash
  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { scaleX: stretch.value },
      { scaleY: 1 - (stretch.value - 1) * STRETCH_Y_RATIO },
    ],
  }));

  // Layer A: pill — 収縮で下へ沈みつつ僅かに縮んで消える
  const pillMotionStyle = useAnimatedStyle(() => {
    const p = shrink.value;
    return {
      opacity: interpolate(p, [0, 0.5], [1, 0], Extrapolation.CLAMP),
      transform: [
        { translateY: interpolate(p, [0, 1], [0, PILL_EXIT_Y]) },
        { scale: interpolate(p, [0, 1], [1, PILL_EXIT_SCALE]) },
      ],
    };
  });

  // Layer B: ball — 収縮後半で浮き上がりながら pop in
  const ballMotionStyle = useAnimatedStyle(() => {
    const p = shrink.value;
    return {
      opacity: interpolate(p, [0.35, 0.85], [0, 1], Extrapolation.CLAMP),
      transform: [
        { translateY: interpolate(p, [0.3, 1], [BALL_ENTER_Y, 0], Extrapolation.CLAMP) },
        { scale: interpolate(p, [0.3, 1], [BALL_ENTER_SCALE, 1], Extrapolation.CLAMP) },
      ],
    };
  });

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: PILL_HEIGHT + bottom + 8,
        },
        entranceStyle,
      ]}
    >
      {/* ===== 下端フェードスクリム (2026-06-14) =====
          floating pill は周囲(左右マージン / pill-FAB 間)が透明なため、スクロール中の
          投稿アクション行などがその透明域から透けて「UI がたまにおかしい」状態になっていた。
          content を bg へ馴染ませて透けを消す。pointerEvents none で gap のタップは素通し。
          transform は持たないので morph には一切影響しない。 */}
      <LinearGradient
        pointerEvents="none"
        colors={['transparent', C.bg]}
        locations={[0, 0.7]}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: PILL_HEIGHT + bottom + 8 + 40,
        }}
      />

      {/* ===== Layer A: Glass pill (展開サイズ固定 / transform で退場) ===== */}
      <Animated.View
        pointerEvents={collapsed ? 'none' : 'auto'}
        accessibilityElementsHidden={collapsed}
        importantForAccessibility={collapsed ? 'no-hide-descendants' : 'auto'}
        style={[
          {
            position: 'absolute',
            bottom,
            left: EXPANDED_LEFT,
            width: EXPANDED_WIDTH,
            height: PILL_HEIGHT,
            borderRadius: PILL_RADIUS,
            backgroundColor: pillBg,
            borderWidth: 1,
            borderColor: pillBorder,
            overflow: 'hidden', // 子 (blur/cell) を角丸にクリップ
          },
          shadowStyle,
          pillMotionStyle,
          webExtra as object,
        ]}
      >
        {/* (iOS) 本物の backdrop blur — レイアウト固定なので blur 再計算なし */}
        {Platform.OS === 'ios' && (
          <BlurView
            intensity={36}
            tint={isDark ? 'dark' : 'light'}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          />
        )}

        {/* specular highlight — 上端の光の反射 (Liquid Glass の rim light) */}
        <View
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '52%' }}
        >
          <LinearGradient
            colors={[sheenColor, 'rgba(255,255,255,0)']}
            style={{ flex: 1 }}
          />
        </View>

        {/* sliding indicator — 透明なガラス chip (transform のみで移動) */}
        {activeCell && (
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: 'absolute',
                top: INDICATOR_PAD_V,
                left: 0,
                height: INDICATOR_H,
                width: activeCell.width - INDICATOR_INSET_H * 2,
                borderRadius: INDICATOR_RADIUS,
                backgroundColor: indicatorTint,
              },
              indicatorStyle,
            ]}
          />
        )}

        {/* 4 タブの cell 群 */}
        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            height: '100%',
            paddingHorizontal: PILL_PADDING_H,
          }}
        >
          {state.routes.map((route, index) => {
            const focused = state.index === index;
            const tab = ROUTE_TO_TAB[route.name];
            if (!tab) return null;

            const onPress = () => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (event.defaultPrevented) return;
              if (focused) {
                router.navigate(`/(tabs)/${route.name}` as never);
              } else {
                navigation.navigate(route.name, route.params as never);
              }
            };

            return (
              <HapticTab
                key={route.key}
                focused={focused}
                onPress={onPress}
                onPressAgain={() =>
                  setWiggles((w) => ({ ...w, [route.key]: (w[route.key] ?? 0) + 1 }))
                }
                onLayout={(e) =>
                  onCellLayout(
                    index,
                    e.nativeEvent.layout.x,
                    e.nativeEvent.layout.width,
                  )
                }
              >
                <TabItem
                  tab={tab}
                  focused={focused}
                  activeColor={C.accent}
                  wiggleSignal={wiggles[route.key]}
                />
              </HapticTab>
            );
          })}
        </View>
      </Animated.View>

      {/* ===== Layer B: ball (左下 60×60 固定 / transform で登場) ===== */}
      <Animated.View
        pointerEvents={collapsed ? 'auto' : 'none'}
        accessibilityElementsHidden={!collapsed}
        importantForAccessibility={!collapsed ? 'no-hide-descendants' : 'auto'}
        style={[
          {
            position: 'absolute',
            bottom,
            left: BALL_EDGE_INSET,
            width: BALL_SIZE,
            height: BALL_SIZE,
            borderRadius: BALL_SIZE / 2,
            backgroundColor: ballBg,
            borderWidth: 1,
            borderColor: ballBorder,
            overflow: 'hidden',
            alignItems: 'center',
            justifyContent: 'center',
          },
          ballShadowStyle,
          ballMotionStyle,
          webExtra as object,
        ]}
      >
        {Platform.OS === 'ios' && (
          <BlurView
            intensity={36}
            tint={isDark ? 'dark' : 'light'}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          />
        )}
        {activeTabKey && (
          <TabIcon
            tab={activeTabKey}
            focused={true}
            size={ICON_SIZE}
            showLabel={false}
            activeColor={C.accent}
          />
        )}
        {/* tap = 展開 + scroll-to-top。常時 mount (pointerEvents で制御) —
            morph 中の mount/unmount を無くしてフレーム落ちを防ぐ */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="タブバーを展開"
          accessibilityHint="タップするとタブが再表示されます。上にスクロールしても戻ります"
          onPress={expandBar}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />
      </Animated.View>

      {/* ===== 投稿追加 FAB — 収縮中も常時表示 (右下固定) ===== */}
      <View
        pointerEvents={Platform.OS === 'web' ? 'auto' : 'box-none'}
        style={{
          position: 'absolute',
          left: FAB_LEFT,
          bottom,
          width: FAB_SIZE,
          height: FAB_SIZE,
          borderRadius: FAB_SIZE / 2,
        }}
      >
        <PressableScale
          onPress={() => {
            const cid = extractCommunityIdFromPath(pathname);
            const href = cid
              ? `/post/create?community_id=${encodeURIComponent(cid)}`
              : '/post/create';
            router.push(href as never);
          }}
          haptic="tap"
          accessibilityLabel="投稿を作成"
          style={[
            {
              width: FAB_SIZE,
              height: FAB_SIZE,
              borderRadius: FAB_SIZE / 2,
              overflow: 'hidden',
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: pillBorder,
              backgroundColor: pillBg,
            },
            shadowStyle,
            webExtra as object,
          ]}
        >
          {Platform.OS === 'ios' && (
            <BlurView
              intensity={36}
              tint={isDark ? 'dark' : 'light'}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            />
          )}
          <Icon.plus size={30} color={C.accent} strokeWidth={3.2} />
        </PressableScale>
      </View>
    </Animated.View>
  );
}

// ============================================================
// TabItem — 個別タブ (アイコンのみ / ラベル・通知バッジなし)
// ------------------------------------------------------------
// - active icon の色は親 (TabBar) から activeColor で受け取る (accent 紫)。
// - wiggleSignal: active tab 再タップで icon が 1 回 wiggle。
// memo 化で wiggle counter 変化時に他 tab を re-render しない。
// ============================================================
const TabItem = memo(function TabItem({
  tab,
  focused,
  activeColor,
  wiggleSignal,
}: {
  tab: TabKey;
  focused: boolean;
  activeColor: string;
  wiggleSignal?: number;
}) {
  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        width: ICON_SIZE + 8,
        height: ICON_SIZE + 8,
      }}
    >
      <TabIcon
        tab={tab}
        focused={focused}
        size={ICON_SIZE}
        showLabel={false}
        activeColor={activeColor}
        wiggleSignal={wiggleSignal}
      />
    </View>
  );
});
