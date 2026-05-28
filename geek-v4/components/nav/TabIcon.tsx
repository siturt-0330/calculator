import { useEffect } from 'react';
import { View } from 'react-native';
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

// ============================================================
// TabIcon — bottom tab の「ぐっと響く」 active アニメ
// ------------------------------------------------------------
// 設計:
//   - color: text2 ↔ accent を 180ms ease-out で crossfade
//     (lucide-react-native の color prop は animated でないので、
//      focused / unfocused 2 枚を opacity で重ねる方式に)
//   - scale: 1.0 → 1.08 を SPRING_BOUNCY (damping 12, stiffness 280) で弾ませる
//   - wiggle: 親 (TabBar) から `wiggleSignal` を変えると -8deg → +8deg → 0 を 320ms
//             同 tab 再タップ時の "上スクロール feedback" として使う
//   - reduceMotion: scale / wiggle は無効化、color は即時切替
// ============================================================

const COLOR_FADE_MS = 180;
const WIGGLE_DEG = 8;
const WIGGLE_HALF_MS = 110; // 110 + 110 + 100 = 320ms (戻り含む)
const WIGGLE_RETURN_MS = 100;
const FOCUSED_SCALE = 1.08;

export function TabIcon({
  tab,
  focused,
  size = TABBAR.iconSize,
  wiggleSignal,
}: {
  tab: TabKey;
  focused: boolean;
  size?: number;
  // 親 (TabBar) が値を変えるたびに wiggle を 1 回再生 (active tab 再タップ feedback)
  wiggleSignal?: number;
}) {
  const C = useColors();
  const reduceMotion = useReducedMotion();
  const I: LucideIcon = Icon[TAB_TO_ICON[tab]];

  // focused: 0 (unfocused) ↔ 1 (focused)
  const focusedSV = useSharedValue(focused ? 1 : 0);
  // scale (1.0 → 1.08)
  const scaleSV = useSharedValue(focused ? FOCUSED_SCALE : 1);
  // wiggle 用 rotation (deg)
  const rotSV = useSharedValue(0);

  // focused 変化に追従
  useEffect(() => {
    if (reduceMotion) {
      // reduceMotion 時は即時切替 (jump-cut)
      focusedSV.value = focused ? 1 : 0;
      scaleSV.value = focused ? FOCUSED_SCALE : 1;
      return;
    }
    focusedSV.value = withTiming(focused ? 1 : 0, { duration: COLOR_FADE_MS });
    scaleSV.value = withSpring(focused ? FOCUSED_SCALE : 1, SPRING_BOUNCY);
  }, [focused, reduceMotion, focusedSV, scaleSV]);

  // wiggleSignal が変わったら 1 回 wiggle
  useEffect(() => {
    if (wiggleSignal === undefined) return;
    if (reduceMotion) return; // 無効化
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

  return (
    <Animated.View
      style={[
        { width: size, height: size, alignItems: 'center', justifyContent: 'center' },
        aTransform,
      ]}
    >
      {/* unfocused: text2 色 — 上に focused (accent) を重ねる */}
      <Animated.View style={[{ position: 'absolute' }, aInactive]}>
        <I size={size} strokeWidth={TABBAR.iconStroke} color={C.text2} />
      </Animated.View>
      <Animated.View style={[{ position: 'absolute' }, aActive]}>
        <I size={size} strokeWidth={TABBAR.iconStroke} color={C.accent} />
      </Animated.View>
      {/* 固有 size を保つための placeholder (transparent) */}
      <View style={{ width: size, height: size }} />
    </Animated.View>
  );
}
