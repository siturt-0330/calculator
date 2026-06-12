import { useEffect } from 'react';
import { View, Text } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withSequence,
  useReducedMotion,
} from 'react-native-reanimated';
import type { LucideIcon } from 'lucide-react-native';
import { useColors } from '../../hooks/useColors';
import { TABBAR } from '../../design/tabbar';
import { SPRING_BOUNCY } from '../../design/motion';
import { Icon, type IconName } from '../../constants/icons';

export type TabKey = 'home' | 'search' | 'game' | 'community' | 'mypage';

const TAB_TO_ICON: Record<TabKey, IconName> = {
  home: 'home',
  search: 'search',
  game: 'game',
  community: 'community',
  mypage: 'mypage',
};

const TAB_TO_LABEL: Record<TabKey, string> = {
  home: 'ホーム',
  search: '検索',
  game: 'ゲーム',
  community: 'コミュ',
  mypage: 'マイ',
};

// active 時に fill を渡して SF Symbols の .fill variant 相当にする icon の判定マップ。
// lucide は open path を fill すると自動 close (始点-終点を直線で結ぶ) されるため、
// silhouette が成立する形だけ true にする (lucide v0.460 の SVG 実体を確認済):
//   - home:      House の本体 path が z 閉路 → solid な家 silhouette になる ✅
//   - mypage:    User の肩 path は底辺で auto-close + 頭 circle → person.fill 相当 ✅
//   - game:      Gamepad2 の本体 path が z 閉路 → solid なパッド silhouette ✅ (dead route)
//   - search:    虫眼鏡レンズ (circle r=8) が solid 円板になり「検索」に見えない ❌
//   - community: UsersRound の 2 人目が開いた曲線で、auto-close の斜め弦が
//                頭部を横切る楔形に塗り潰れて崩れる ❌
const TAB_FILLABLE: Record<TabKey, boolean> = {
  home: true,
  search: false,
  game: true,
  community: false,
  mypage: true,
};

// ============================================================
// TabIcon — floating-pill tab bar 内のアイコン (+ optional label)
// ------------------------------------------------------------
// 設計 (2026-05-29 「昔の TabBar」リバイバル):
//   - active (focused): scale 1.0 + accent カラー + fill (塗り対応 icon のみ)
//     inactive:         scale 0.95 + text2 (gray) で subtle
//   - color は active / inactive を opacity で重ねて crossfade
//     (lucide-react-native の color prop は animated 不可)
//   - showLabel=true の場合のみ右側に label を inline 表示
//     (現状の floating-pill 設計では label は親 TabBar の chip 側で
//      レンダリングするため showLabel は基本 false 運用、本コンポーネント
//      は再利用性のため引数自体は受け取る)
//   - wiggleSignal: 値が変わるたびに 1 回 -8deg → +8deg → 0 の wiggle
//   - reduceMotion: scale / wiggle 無効、color は即時切替
// ============================================================

const COLOR_FADE_MS = 180;
const WIGGLE_DEG = 8;
const WIGGLE_HALF_MS = 110;
const WIGGLE_RETURN_MS = 100;
// 仕様: focused = 1.0 / inactive = 0.95 で subtle に
const FOCUSED_SCALE = 1.0;
const INACTIVE_SCALE = 0.95;

export function TabIcon({
  tab,
  focused,
  size = TABBAR.iconSize,
  showLabel = false,
  label,
  wiggleSignal,
  activeColor,
}: {
  tab: TabKey;
  focused: boolean;
  size?: number;
  // true なら icon の右隣に label を inline 表示する。
  // floating-pill TabBar 側で label をレンダリングしている場合は false (default)。
  showLabel?: boolean;
  // 明示的に label テキストを指定したいとき (省略時は TAB_TO_LABEL を使用)。
  label?: string;
  // 親が値を変えるたびに wiggle を 1 回再生 (active tab 再タップ feedback)
  wiggleSignal?: number;
  // active 状態の icon 色 (省略時は C.accent)。
  // Liquid TabBar のグラデ indicator 上では '#fff' を渡す (2026-06-12)。
  activeColor?: string;
}) {
  const C = useColors();
  const reduceMotion = useReducedMotion();
  const I: LucideIcon = Icon[TAB_TO_ICON[tab]];
  const resolvedLabel = label ?? TAB_TO_LABEL[tab];
  const focusedColor = activeColor ?? C.accent;

  // focused: 0 (unfocused) ↔ 1 (focused)
  const focusedSV = useSharedValue(focused ? 1 : 0);
  // scale (inactive 0.95 ↔ focused 1.0)
  const scaleSV = useSharedValue(focused ? FOCUSED_SCALE : INACTIVE_SCALE);
  // wiggle 用 rotation (deg)
  const rotSV = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      focusedSV.value = focused ? 1 : 0;
      scaleSV.value = focused ? FOCUSED_SCALE : INACTIVE_SCALE;
      return;
    }
    focusedSV.value = withTiming(focused ? 1 : 0, { duration: COLOR_FADE_MS });
    scaleSV.value = withSpring(
      focused ? FOCUSED_SCALE : INACTIVE_SCALE,
      SPRING_BOUNCY,
    );
  }, [focused, reduceMotion, focusedSV, scaleSV]);

  useEffect(() => {
    if (wiggleSignal === undefined) return;
    if (reduceMotion) return;
    rotSV.value = withSequence(
      withTiming(-WIGGLE_DEG, { duration: WIGGLE_HALF_MS }),
      withTiming(WIGGLE_DEG, { duration: WIGGLE_HALF_MS }),
      withTiming(0, { duration: WIGGLE_RETURN_MS }),
    );
  }, [wiggleSignal, reduceMotion, rotSV]);

  // active icon (accent 色) — opacity で fade-in
  const aActive = useAnimatedStyle(() => ({
    opacity: focusedSV.value,
  }));
  // inactive icon (text2 色) — focused の反転で fade-out
  const aInactive = useAnimatedStyle(() => ({
    opacity: 1 - focusedSV.value,
  }));
  // 共通 transform: scale + wiggle rotation
  const aTransform = useAnimatedStyle(() => ({
    transform: [
      { scale: scaleSV.value },
      { rotate: `${rotSV.value}deg` },
    ],
  }));

  const iconNode = (
    <Animated.View
      style={[
        { width: size, height: size, alignItems: 'center', justifyContent: 'center' },
        aTransform,
      ]}
    >
      <Animated.View style={[{ position: 'absolute' }, aInactive]}>
        <I size={size} strokeWidth={TABBAR.iconStroke} color={C.text2} />
      </Animated.View>
      <Animated.View style={[{ position: 'absolute' }, aActive]}>
        {/* fill は active 側のみ。crossfade で outline → filled に滑らかに遷移する */}
        <I
          size={size}
          strokeWidth={TABBAR.iconStroke}
          color={focusedColor}
          fill={TAB_FILLABLE[tab] ? focusedColor : undefined}
        />
      </Animated.View>
      {/* size 確保用 placeholder (transparent) */}
      <View style={{ width: size, height: size }} />
    </Animated.View>
  );

  if (!showLabel) return iconNode;

  // showLabel=true のときは icon + label を横並びに
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {iconNode}
      <Text
        numberOfLines={1}
        style={{
          marginLeft: 6,
          fontSize: 13,
          lineHeight: 16,
          fontWeight: '700',
          color: focused ? focusedColor : C.text2,
          letterSpacing: 0.1,
        }}
      >
        {resolvedLabel}
      </Text>
    </View>
  );
}
