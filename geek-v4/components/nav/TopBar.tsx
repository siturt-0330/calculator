import { Platform, View, ViewStyle, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  SharedValue,
} from 'react-native-reanimated';
import { SP, SIZE } from '../../design/tokens';
import { T } from '../../design/typography';
import { useColors } from '../../hooks/useColors';
import { useResolvedTheme } from '../../lib/theme/themeStore';

type Props = {
  title?: string;
  large?: boolean;
  scrollY?: SharedValue<number>;
  left?: React.ReactNode;
  right?: React.ReactNode;
  style?: ViewStyle;
  // border は後方互換のため残す (default: true) が、iOS-native では
  // hairline + 透明 + blur で表現するため厳密な境界線は使わない。
  border?: boolean;
};

// ============================================================
// iOS-native TopBar
// ------------------------------------------------------------
// 設計 (2026-05-28 polish):
//   - 透明 + blur backdrop (expo-blur BlurView, intensity scroll 連動)
//   - large モード: iOS 11+ の large title スタイル
//     - 上部にも常時 title (小) を置くが、large 表示中は opacity=0
//     - スクロール量 [0, 60] で large title の opacity / scale が縮み、
//       上部 small title の opacity が上がる "collapse" 表現
//   - 影は無し、scroll 量に応じて極薄 hairline がフェードイン
//   - border prop は後方互換で残す (false で hairline 完全 off)
// ============================================================

// collapse の閾値 (スクロール量で large title が小 title に切替わる)
const COLLAPSE_START = 0;
const COLLAPSE_END = 60;
// blur intensity の range (transparent → 上位)
const BLUR_INTENSITY_MAX = 80;

export function TopBar({
  title,
  large,
  scrollY,
  left,
  right,
  style,
  border = true,
}: Props) {
  const insets = useSafeAreaInsets();
  const C = useColors();
  const theme = useResolvedTheme();
  const isDark = theme === 'dark';
  const reduceMotion = useReducedMotion();

  // 上部 small title の opacity:
  // - large モード: scrollY が COLLAPSE_END に近づくと現れる
  // - 非 large モード: 常時表示
  const aSmallTitle = useAnimatedStyle(() => {
    if (!large) return { opacity: 1 };
    if (!scrollY) return { opacity: 0 };
    return {
      opacity: interpolate(
        scrollY.value,
        [COLLAPSE_START, COLLAPSE_END],
        [0, 1],
        'clamp',
      ),
    };
  });

  // large title 本体 (下部) の collapse: opacity と translateY/scale で縮む
  const aLargeTitle = useAnimatedStyle(() => {
    if (!large) return { opacity: 1 };
    if (!scrollY || reduceMotion) return { opacity: 1 };
    const o = interpolate(
      scrollY.value,
      [COLLAPSE_START, COLLAPSE_END - 10],
      [1, 0],
      'clamp',
    );
    const ty = interpolate(
      scrollY.value,
      [COLLAPSE_START, COLLAPSE_END],
      [0, -8],
      'clamp',
    );
    return { opacity: o, transform: [{ translateY: ty }] };
  });

  // hairline (極薄の境界線): scroll 後半でだけうっすら出す
  const aHairline = useAnimatedStyle(() => {
    if (!border) return { opacity: 0 };
    if (!scrollY) return { opacity: 1 };
    return {
      opacity: interpolate(
        scrollY.value,
        [30, COLLAPSE_END],
        [0, 1],
        'clamp',
      ),
    };
  });

  // backdrop の不透明度 (transparent → ほぼ opaque)
  // scrollY が undefined のときは static で常時表示
  const aBackdrop = useAnimatedStyle(() => {
    if (!scrollY || reduceMotion) return { opacity: 1 };
    return {
      opacity: interpolate(
        scrollY.value,
        [COLLAPSE_START, COLLAPSE_END],
        [0, 1],
        'clamp',
      ),
    };
  });

  // web 用の動的 backdrop-filter (scroll で blur 強化)
  const aWebBackdrop = useAnimatedStyle(() => {
    if (Platform.OS !== 'web') return {};
    if (!scrollY || reduceMotion) {
      return {
        backdropFilter: 'blur(30px) saturate(180%)',
        WebkitBackdropFilter: 'blur(30px) saturate(180%)',
      } as object;
    }
    const blurPx = interpolate(
      scrollY.value,
      [COLLAPSE_START, COLLAPSE_END],
      [0, 30],
      'clamp',
    );
    return {
      backdropFilter: `blur(${blurPx}px) saturate(180%)`,
      WebkitBackdropFilter: `blur(${blurPx}px) saturate(180%)`,
    } as object;
  });

  const blurTint = (
    isDark ? 'systemUltraThinMaterialDark' : 'systemUltraThinMaterialLight'
  ) as 'systemUltraThinMaterialDark' | 'systemUltraThinMaterialLight';

  const hairlineColor = isDark
    ? 'rgba(255,255,255,0.10)'
    : 'rgba(0,0,0,0.10)';

  const webBgColor = isDark ? 'rgba(0,0,0,0.70)' : 'rgba(255,255,255,0.70)';
  const fallbackBg = isDark ? 'rgba(20,20,23,0.92)' : 'rgba(250,250,252,0.88)';

  return (
    <View
      style={[
        {
          paddingTop: insets.top,
        },
        style,
      ]}
    >
      {/* backdrop: native = BlurView, web = backdrop-filter */}
      {Platform.OS === 'web' ? (
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: webBgColor },
            aBackdrop,
            aWebBackdrop,
          ]}
        />
      ) : (
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, aBackdrop]}
        >
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: fallbackBg },
            ]}
          />
          <BlurView
            intensity={BLUR_INTENSITY_MAX}
            tint={blurTint}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      )}

      {/* 下端 hairline (scroll 進行で fade in) */}
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: StyleSheet.hairlineWidth,
            backgroundColor: hairlineColor,
          },
          aHairline,
        ]}
      />

      {/* row 1 — left action, small title (large mode では scroll で出る), right action */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: SP['4'],
          height: SIZE.topBar,
          gap: SP['2'],
        }}
      >
        {left}
        <Animated.Text
          numberOfLines={1}
          style={[
            T.h3,
            {
              color: C.text,
              flex: 1,
              textAlign: large ? 'center' : 'left',
            },
            aSmallTitle,
          ]}
        >
          {title ?? ''}
        </Animated.Text>
        {right}
      </View>

      {/* row 2 — large title (iOS 11+ 大きいタイトル) */}
      {large && title && (
        <Animated.View
          style={[
            { paddingHorizontal: SP['4'], paddingBottom: SP['3'] },
            aLargeTitle,
          ]}
        >
          <Animated.Text style={[T.display, { color: C.text }]}>
            {title}
          </Animated.Text>
        </Animated.View>
      )}
    </View>
  );
}
