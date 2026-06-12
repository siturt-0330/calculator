import { Platform, View, ViewStyle, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import Animated, {
  interpolate,
  useAnimatedStyle,
  SharedValue,
} from 'react-native-reanimated';
import { SP, SIZE } from '../../design/tokens';
import { T } from '../../design/typography';
import { useColors } from '../../hooks/useColors';
import { useReduceTransparency } from '../../hooks/useReduceTransparency';
import { useResolvedTheme } from '../../lib/theme/themeStore';

type Props = {
  title?: string;
  /**
   * iOS 11+ の large title スタイル。
   * 使い方: `<TopBar title="設定" large scrollY={scrollY} />` のように
   * `scrollY` (Reanimated SharedValue。`useAnimatedScrollHandler` 等でリストの
   * contentOffset.y を流し込む) とセットで渡すと、スクロール量 [0, 60] で
   * 下段の大タイトルが消え、上段の小タイトルがフェードインする collapse 表現になる。
   * `scrollY` 無しだと大タイトルが静的に出続けるだけ。
   * ※ 注意: collapse は opacity / translateY のみで **バーの高さ自体は縮まない**
   *   (row 2 のレイアウトは残る)。高さも詰めたい画面では現状使えない。
   *   2026-06 時点で実渡し 0 件 (将来の large title 画面用に維持)。
   */
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
  // ★ a11y の役割分担 (Apple HIG / Obsidian「Apple Liquid Glass 設計言語」§4):
  //   - Reduce Motion が無効化するのは「弾性アニメ・大きな移動」。scroll に 1:1
  //     追従する opacity 補間は motion ではないため、この file の scroll 連動
  //     interpolate (aBackdrop / aLargeTitle / aHairline) は RM でも維持する
  //     (時間アニメ withTiming/withSpring はこの file に存在しない)。
  //     旧実装は RM で backdrop を常時 opaque に固定し scroll edge appearance を
  //     失っていた — それは Reduce Transparency の仕事の取り違え。
  //   - Reduce Transparency ON のときだけ blur/透過をやめて不透明 bg に fallback。
  const reduceTransparency = useReduceTransparency();

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
    // ※ reduce motion でも collapse は維持する (scroll 1:1 追従 = motion ではない。
    //   UIKit の large title も RM 下で collapse する)。RM で固定すると
    //   aSmallTitle 側だけ fade in して大小タイトルが二重表示になるバグだった。
    if (!scrollY) return { opacity: 1 };
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
  // ※ reduce motion でも scroll edge appearance (上端で透明 → スクロールで opaque)
  //   は維持する。旧実装の `|| reduceMotion` → 常時 opaque は HIG の取り違え (上記)。
  const aBackdrop = useAnimatedStyle(() => {
    if (!scrollY) return { opacity: 1 };
    return {
      opacity: interpolate(
        scrollY.value,
        [COLLAPSE_START, COLLAPSE_END],
        [0, 1],
        'clamp',
      ),
    };
  });

  // ----- web の frosted は背景レイヤに「静的 blur」を直書き(下記 JSX)。-----
  //   ★ 旧実装は blur 半径を scrollY で 0→30px と毎フレーム動かしていたが、
  //     backdrop-filter の blur 半径アニメは web/Safari で最も重い再描画
  //     (背後の生スクロール領域を毎フレーム再 blur)で「かくかく」の主因だった。
  //     blur は固定にし、バーの出現は同レイヤ aBackdrop の opacity フェードだけで
  //     担う(opacity は合成のみで安い。blur 面は合成キャッシュ可能な定数になる)。

  const blurTint = (
    isDark ? 'systemUltraThinMaterialDark' : 'systemUltraThinMaterialLight'
  ) as 'systemUltraThinMaterialDark' | 'systemUltraThinMaterialLight';

  const hairlineColor = isDark
    ? 'rgba(255,255,255,0.10)'
    : 'rgba(0,0,0,0.12)';

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
      {/* backdrop: native = BlurView, web = backdrop-filter
          Reduce Transparency ON のときは blur/透過を使わず不透明 bg (C.bg)。
          scroll edge appearance (aBackdrop の opacity 補間) はどちらでも維持。 */}
      {Platform.OS === 'web' ? (
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            reduceTransparency
              ? { backgroundColor: C.bg }
              : {
                  backgroundColor: webBgColor,
                  // ★ blur 半径は固定。毎フレーム動かさないことで Safari の全面再描画を断つ。
                  ...({
                    backdropFilter: 'blur(30px) saturate(180%)',
                    WebkitBackdropFilter: 'blur(30px) saturate(180%)',
                  } as object),
                },
            aBackdrop,
          ]}
        />
      ) : (
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, aBackdrop]}
        >
          {reduceTransparency ? (
            <View
              style={[StyleSheet.absoluteFill, { backgroundColor: C.bg }]}
            />
          ) : (
            <>
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
            </>
          )}
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
