// ============================================================
// GeekRefreshControl — gradient ring pull-to-refresh polish
// ------------------------------------------------------------
// 体感目的:
//   標準 <RefreshControl> の OS 既定 spinner (iOS グレー線 / Android Material
//   円弧) は機能としては OK だが、Geek の brand identity (紫→ピンクの
//   primary gradient) を全く反映しない。pull-to-refresh は「ユーザーが
//   能動的に作る瞬間」なので、ここを brand-color の輪っかで彩ると
//   「自分の操作がアプリに伝わった」確かさが増す。
//
// 設計:
//   この component は 2 つの export を持つ:
//
//   1) <GeekRefreshControl /> — 既存の <RefreshControl> を直接置換するための
//      薄い wrapper。`refreshing` / `onRefresh` を受け取り、本物の
//      RefreshControl を返す (FlashList の refreshControl prop に渡せる)。
//      tintColor / colors は GRAD.primary[0] (紫) に統一されるので、OS 既定の
//      grey spinner より「Geek らしさ」が出る。これだけでも体感はかなり良く
//      なる (FlashList を Animated.ScrollView に置換しないで済む)。
//
//   2) <GeekRefreshIndicator refreshing /> — gradient ring の overlay。
//      ListHeaderComponent や absolute-positioned wrapper として置けば、
//      `refreshing` が true の間、画面上部中央に gradient ring spinner が
//      クルクル回る (= "Geek polish")。OS spinner と二重に出るのが嫌なら
//      呼び出し側で `tintColor="transparent"` にして overlay 側を main にする
//      使い方も可能。
//
// なぜ "custom Animated.ScrollView from scratch" にしないか:
//   - 既存の list 画面 (feed / community / mypage / bbs) はすべて FlashList
//     を使っている。FlashList は内部で独自の virtualization を持ち、
//     Animated.ScrollView ベースに移植するのは「touch every file」になる。
//   - 本タスクの scope は "component を polish する" であって retrofit ではない
//     (spec 注釈: "actual list pages will need to opt-in by using this
//     wrapper. That's a follow-up").
//   - 上記 2 piece に分けることで、消費側は段階的に opt-in できる
//     (refreshControl を差し替えるだけでも brand 色は反映される)。
//
// ReduceMotion 対応:
//   useReducedMotion() が true のとき:
//     - rotation を skip (静止した ring を表示)
//     - 内部の sparkles も pulse させない
//   ring の見た目は維持 — 完全に消すと「現在 refresh 中」が分からなくなる。
//
// Performance 配慮:
//   - useSharedValue + Reanimated worklet — JS thread は触らない。
//   - rotation animation は `refreshing` flag に駆動。false に戻ったら
//     cancel して shared value を 0 に。スクロール中の余計な動きはなし。
//   - LinearGradient 自体は static — animation は transform: rotate のみ。
// ============================================================

import { memo, useEffect, useMemo } from 'react';
import {
  Platform,
  RefreshControl,
  type RefreshControlProps,
  View,
  type ViewStyle,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Sparkles } from 'lucide-react-native';

import { useColors, useGradients } from '../../hooks/useColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';

// ============================================================
// Constants
// ============================================================

// ring 外径 (spec: 36-40px)
const RING_SIZE = 38;
// ring 線幅 (spec: 3px)
const RING_THICKNESS = 3;
// 中央 sparkles のサイズ (ring 内側に余裕を持って収まる)
const ICON_SIZE = 14;
// 1 周期 (spec: 800ms)
const ROTATION_DURATION_MS = 800;

// ============================================================
// <GeekRefreshControl /> — drop-in <RefreshControl> 置換
// ============================================================
//
// FlashList / ScrollView の `refreshControl` prop に渡す用途。
// 標準 RefreshControl と同じ props 体系を受け取りつつ、color 系の default を
// Geek の brand gradient 先頭色 (紫) に揃える。
//
// 注: RN の RefreshControl はネイティブの spinner UI を replace できない
// (iOS は UIRefreshControl, Android は SwipeRefreshLayout のラッパで、いずれも
// 描画は OS 側)。なので "gradient ring spinner" の見た目は
// <GeekRefreshIndicator /> 側で実現する。本 wrapper の役目は color tint だけ。

export type GeekRefreshControlProps = Omit<RefreshControlProps, 'tintColor' | 'colors'> & {
  /**
   * iOS の indicator tint. 未指定なら GRAD.primary[0] (紫).
   * 透明にして上に <GeekRefreshIndicator /> を被せたい場合は "transparent" を渡す.
   */
  tintColor?: string;
  /**
   * Android の indicator colors. 未指定なら GRAD.primary 全色 (グラデっぽく循環).
   */
  colors?: readonly string[];
};

function GeekRefreshControlImpl(props: GeekRefreshControlProps) {
  const GRAD = useGradients();
  const C = useColors();

  const tintColor = props.tintColor ?? GRAD.primary[0];
  // Android の colors は cycle. 紫→ピンク→紫 で回るとそれっぽい.
  const colors = (props.colors ?? GRAD.primary) as unknown as string[];

  return (
    <RefreshControl
      {...props}
      tintColor={tintColor}
      colors={colors}
      // iOS の "Pull to refresh" のラベル色も合わせる. 既定 (props で来てれば
      // それを優先) — 来てなければ undefined のまま OS 既定に任せる.
      progressBackgroundColor={props.progressBackgroundColor ?? C.bg2}
    />
  );
}

export const GeekRefreshControl = memo(GeekRefreshControlImpl);

// ============================================================
// <GeekRefreshIndicator /> — gradient ring spinner overlay
// ============================================================
//
// 使い方 (ListHeader として):
//   <FlashList
//     ListHeaderComponent={<GeekRefreshIndicator refreshing={refreshing} />}
//     ...
//   />
//
// 使い方 (absolute overlay として):
//   <View>
//     <FlashList ... />
//     <View pointerEvents="none" style={StyleSheet.absoluteFill}>
//       <GeekRefreshIndicator refreshing={refreshing} style={{ marginTop: 8 }} />
//     </View>
//   </View>

export interface GeekRefreshIndicatorProps {
  /** refreshing=true の間だけ ring が visible & 回転する */
  refreshing: boolean;
  /** 表示位置の微調整用. default は何もなし (親の layout に従う). */
  style?: ViewStyle;
  /** ring のサイズ override. default 38. */
  size?: number;
  /** ring の線幅 override. default 3. */
  thickness?: number;
}

function GeekRefreshIndicatorImpl({
  refreshing,
  style,
  size = RING_SIZE,
  thickness = RING_THICKNESS,
}: GeekRefreshIndicatorProps) {
  const GRAD = useGradients();
  const C = useColors();
  const reduceMotion = useReducedMotion();

  // rotation shared value. 0 → 360 を loop.
  const rotation = useSharedValue(0);
  // refresh が止まったあとの fade-out 用. 1 → 0 / 0 → 1.
  const visibility = useSharedValue(refreshing ? 1 : 0);

  useEffect(() => {
    if (refreshing) {
      // visible に
      visibility.value = withTiming(1, { duration: 180, easing: Easing.out(Easing.quad) });
      if (!reduceMotion) {
        // rotation を 0 から再開. ループ.
        rotation.value = 0;
        rotation.value = withRepeat(
          withTiming(360, {
            duration: ROTATION_DURATION_MS,
            // linear で滑らかに. 端での緩急は spinner には不自然.
            easing: Easing.linear,
          }),
          -1,
          false,
        );
      } else {
        // reduce motion: rotation せず static.
        rotation.value = 0;
      }
    } else {
      // fade out + rotation 停止
      cancelAnimation(rotation);
      visibility.value = withTiming(0, { duration: 240, easing: Easing.in(Easing.quad) });
    }
    // cleanup: unmount 時に rotation が走り続けないように.
    return () => {
      cancelAnimation(rotation);
    };
  }, [refreshing, reduceMotion, rotation, visibility]);

  const ringAnimStyle = useAnimatedStyle(() => {
    'worklet';
    return {
      opacity: visibility.value,
      // refreshing=true で 1.0, fade-out 中は 0.6 まで縮む
      transform: [
        { scale: 0.6 + visibility.value * 0.4 },
        { rotate: `${rotation.value}deg` },
      ],
    };
  });

  // gradient 色を memo. テーマが変わったときだけ更新.
  const gradColors = useMemo<readonly [string, string, string]>(
    () => GRAD.primary,
    [GRAD.primary],
  );

  // 中央の sparkles 色は accentLight 系 (ring の中で目立ちすぎないよう低 opacity)
  const iconColor = C.accentLight;

  // container 高さ — ListHeader として置いたとき、refreshing=false でも
  // レイアウト跳ねしないよう常に reserve. ただし visibility=0 で透明.
  // 親側で reserved space が要らないなら style で height:0 を上書きできる.
  const containerHeight = size + 16; // ring + 上下 8px margin

  return (
    <View
      pointerEvents="none"
      style={[
        {
          width: '100%',
          height: containerHeight,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <Animated.View
        style={[
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            alignItems: 'center',
            justifyContent: 'center',
          },
          ringAnimStyle,
        ]}
      >
        {/* 外側の gradient ring. LinearGradient を円形 mask する代わりに、
            "gradient で塗った正方形" の上に "bg 色で塗った小さい円" を重ねて
            ドーナツを作る. React Native の border-image は安定しないので
            この overlay 方式が一番 cross-platform に綺麗.
            (RN の `borderImage` は未対応, `MaskedView` は依存が増えるので避ける) */}
        <LinearGradient
          colors={gradColors as unknown as [string, string, string]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: size,
            height: size,
            borderRadius: size / 2,
          }}
        />
        {/* 内側の "穴" — bg 色で塗った小さい円. これで gradient が ring の
            形に見える. */}
        <View
          style={{
            position: 'absolute',
            top: thickness,
            left: thickness,
            width: size - thickness * 2,
            height: size - thickness * 2,
            borderRadius: (size - thickness * 2) / 2,
            backgroundColor: C.bg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* 中央 sparkles. 低 opacity で「装飾」感を出す.
              ring の rotation と一緒に回るとビジー過ぎるので、icon は
              counter-rotate して "止まって見える" 演出にする. */}
          <Animated.View style={useCounterRotateStyle(rotation)}>
            <Sparkles
              size={ICON_SIZE}
              color={iconColor}
              strokeWidth={2}
              opacity={0.5}
            />
          </Animated.View>
        </View>
      </Animated.View>
    </View>
  );
}

// counter-rotate 用 hook — ring が +360 回るのに対して icon は -360 回せば
// icon は静止して見える. これで icon が「ring の中心に固定された装飾」に見える.
// (worklet 内で `${-rotation.value}deg` は OK)
function useCounterRotateStyle(rotation: Animated.SharedValue<number>) {
  // この hook 専用に作ったが、もっと汎用にすることもできる. ここでは
  // GeekRefreshIndicator 内部だけで使うので private.
  return useAnimatedStyle(() => {
    'worklet';
    return {
      transform: [{ rotate: `${-rotation.value}deg` }],
    };
  });
}

export const GeekRefreshIndicator = memo(GeekRefreshIndicatorImpl);

// ============================================================
// Default export — drop-in 置換用に GeekRefreshControl を default に.
// ============================================================
export default GeekRefreshControl;

// Web 環境の note:
//   Platform.OS === 'web' のとき、RefreshControl は no-op に近い (RN Web は
//   pull-to-refresh をネイティブ実装しない). この component も web では
//   tintColor 等が無視されるだけで、エラーにはならない. web 体験を完全に
//   揃えたい場合は GeekRefreshIndicator を absolute overlay として使い、
//   refreshing flag は呼び出し側で button 等から制御する.
void Platform; // tree-shaking 防止用 (import が "未使用" 扱いされないよう参照)
