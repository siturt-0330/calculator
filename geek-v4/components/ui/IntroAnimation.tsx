import { useEffect } from 'react';
import { StyleSheet, Dimensions, Platform, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  runOnJS,
  Easing,
} from 'react-native-reanimated';

// ============================================================
// Geek イントロ
//   1. G が画面中央でフェードイン
//   2. G が左へスライドしながら e, e, k が右側に順に出現
//   3. "Geek" 完成 → 短いホールド
//   4. 大胆な突き抜けズーム (画面を貫通する勢い)
//   5. フェードアウト
// 紫グローは控えめ (黒背景を主役に)
// ============================================================

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const SHORTER = Math.min(SCREEN_W, SCREEN_H);

const CFG = {
  // 文字
  FONT_SIZE:       Math.round(Math.min(SHORTER * 0.26, 150)),
  LETTER_SPACING:  0,
  BG_COLOR:        '#000000',
  LOGO_COLOR:      '#FFFFFF',
  GLOW_COLOR:      '#7C6AF7',

  // タイミング (ms)
  G_REVEAL:        520,    // G が中央でフェードイン
  G_CENTER_HOLD:   360,    // G を中央でホールド
  SHIFT_DURATION:  900,    // G が左へ移動する尺
  LETTER_STAGGER:  170,    // e→e→k の登場間隔
  LETTER_REVEAL:   380,    // 1文字のフェードイン
  POST_FORM_HOLD:  260,    // 完成後ホールド (グロー一瞬)
  GLOW_FLASH:      280,    // グロー (短く控えめ)
  ZOOM_DURATION:   2000,   // ズームイン尺
  ZOOM_MAX:        25,     // ★ 突き抜ける勢いの拡大率
  FADE_OUT:        420,
};

const LETTERS = ['G', 'e', 'e', 'k'] as const;

// "Geek" の幅推定 (Inter Bold) — 各文字を FONT_SIZE 比で
const W_RATIO: Record<string, number> = { G: 0.66, e: 0.46, k: 0.55 };

// G を中央に置く時の word-row の translateX
// = (e + e + k の合計幅) / 2
const G_CENTER_SHIFT_RATIO =
  (W_RATIO.e! + W_RATIO.e! + W_RATIO.k!) / 2;

export function IntroAnimation({ onComplete }: { onComplete: () => void }) {
  // 各文字の opacity
  const op0 = useSharedValue(0);    // G
  const op1 = useSharedValue(0);    // e
  const op2 = useSharedValue(0);    // e
  const op3 = useSharedValue(0);    // k
  const opacities = [op0, op1, op2, op3];

  // G の上から降りる初期オフセット
  const tyG = useSharedValue(28);
  // e/e/k は右から少しスライドして登場
  const tx1 = useSharedValue(40);
  const tx2 = useSharedValue(40);
  const tx3 = useSharedValue(40);
  const xOffsets = [tx1, tx2, tx3];

  // word-row の translateX (G 中央 → 全部中央)
  const wordShift = useSharedValue(CFG.FONT_SIZE * G_CENTER_SHIFT_RATIO);

  // グロー (短く控えめにフラッシュ)
  const glow = useSharedValue(0);
  // 全体のスケール (ズーム用)
  const zoom = useSharedValue(1);
  // コンテナ不透明度 (フェードアウト用)
  const containerOp = useSharedValue(1);

  useEffect(() => {
    const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);
    const EASE_SHIFT = Easing.bezier(0.22, 1, 0.36, 1);

    // 1) G を中央でフェードイン
    op0.value = withTiming(1, { duration: CFG.G_REVEAL, easing: EASE_OUT });
    tyG.value = withTiming(0, { duration: CFG.G_REVEAL, easing: EASE_OUT });

    // 2) G を中央でホールド → 左へスライド開始 (eek 登場と同時)
    const shiftStart = CFG.G_REVEAL + CFG.G_CENTER_HOLD;
    wordShift.value = withDelay(
      shiftStart,
      withTiming(0, { duration: CFG.SHIFT_DURATION, easing: EASE_SHIFT }),
    );

    // 3) e, e, k が右から順に登場
    for (let i = 0; i < 3; i++) {
      const v = opacities[i + 1]!;
      const tx = xOffsets[i]!;
      const delay = shiftStart + i * CFG.LETTER_STAGGER + 60;
      v.value = withDelay(
        delay,
        withTiming(1, { duration: CFG.LETTER_REVEAL, easing: EASE_OUT }),
      );
      tx.value = withDelay(
        delay,
        withTiming(0, { duration: CFG.LETTER_REVEAL, easing: EASE_OUT }),
      );
    }

    // 4) 全部出揃った瞬間にグローを一瞬だけフラッシュ (控えめ)
    const formCompleteAt =
      shiftStart + 2 * CFG.LETTER_STAGGER + 60 + CFG.LETTER_REVEAL;
    glow.value = withDelay(
      formCompleteAt - 40,
      withTiming(1, { duration: CFG.GLOW_FLASH, easing: Easing.out(Easing.cubic) }, () => {
        // すぐ消える
        glow.value = withTiming(0, { duration: 480, easing: Easing.in(Easing.quad) });
      }),
    );

    // 5) ズーム開始 (突き抜ける勢い)
    const zoomStart = formCompleteAt + CFG.POST_FORM_HOLD;
    zoom.value = withDelay(
      zoomStart,
      withTiming(CFG.ZOOM_MAX, {
        duration: CFG.ZOOM_DURATION,
        // 後半で爆発的に加速 (Netflix 風)
        easing: Easing.bezier(0.32, 0, 0.68, 0.06),
      }),
    );

    // 6) フェードアウトはズーム終盤と重ねる
    const fadeStart = zoomStart + CFG.ZOOM_DURATION - 240;
    containerOp.value = withDelay(
      fadeStart,
      withTiming(0, { duration: CFG.FADE_OUT, easing: Easing.in(Easing.quad) }, () => {
        runOnJS(onComplete)();
      }),
    );

    // Safety
    const total = fadeStart + CFG.FADE_OUT + 1500;
    const safety = setTimeout(onComplete, total);
    return () => clearTimeout(safety);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: containerOp.value,
  }));

  const zoomStyle = useAnimatedStyle(() => ({
    transform: [{ scale: zoom.value }],
  }));

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: wordShift.value }],
  }));

  const baseLogo = baseLogoStyle();

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundColor: CFG.BG_COLOR,
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          overflow: 'hidden',
        },
        containerStyle,
      ]}
    >
      <Animated.View style={[zoomStyle]}>
        <Animated.View style={[rowStyle, { flexDirection: 'row', alignItems: 'baseline' }]}>
          {/* G */}
          <Letter
            ch={LETTERS[0]}
            opacity={op0}
            translateY={tyG}
            translateX={null}
            glow={glow}
            baseStyle={baseLogo}
          />
          {/* eek */}
          {[1, 2, 3].map((i) => (
            <Letter
              key={i}
              ch={LETTERS[i]!}
              opacity={opacities[i]!}
              translateY={null}
              translateX={xOffsets[i - 1]!}
              glow={glow}
              baseStyle={baseLogo}
            />
          ))}
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
}

function Letter({
  ch,
  opacity,
  translateY,
  translateX,
  glow,
  baseStyle,
}: {
  ch: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  opacity: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  translateY: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  translateX: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  glow: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  baseStyle: any;
}) {
  // 文字本体
  const charStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateX: translateX ? translateX.value : 0 },
      { translateY: translateY ? translateY.value : 0 },
    ],
  }));

  // グロー (控えめ・ピーク 0.55、すぐ消える)
  const glowStyle = useAnimatedStyle(() => ({
    opacity: opacity.value * glow.value * 0.55,
  }));

  return (
    <View style={{ position: 'relative' }}>
      {/* 控えめなグロー層 */}
      <Animated.Text
        style={[
          baseStyle,
          {
            position: 'absolute',
            color: CFG.LOGO_COLOR,
            textShadowColor: CFG.GLOW_COLOR,
            textShadowRadius: 22,
            textShadowOffset: { width: 0, height: 0 },
            ...(Platform.OS === 'web'
              ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ({
                  textShadow: '0 0 14px #7C6AF7, 0 0 28px #7C6AF7',
                } as any)
              : {}),
          },
          glowStyle,
        ]}
      >
        {ch}
      </Animated.Text>
      {/* 文字本体 */}
      <Animated.Text style={[baseStyle, { color: CFG.LOGO_COLOR }, charStyle]}>
        {ch}
      </Animated.Text>
    </View>
  );
}

function baseLogoStyle() {
  const base = {
    fontFamily: 'Inter_700Bold',
    fontSize: CFG.FONT_SIZE,
    fontWeight: '700' as const,
    letterSpacing: CFG.LETTER_SPACING,
    color: CFG.LOGO_COLOR,
    includeFontPadding: false as const,
  };
  if (Platform.OS === 'web') {
    return {
      ...base,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fontFamily: 'Inter_700Bold, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      WebkitFontSmoothing: 'antialiased',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      MozOsxFontSmoothing: 'grayscale',
      textRendering: 'optimizeLegibility',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }
  return base;
}

// 旧 API 互換 (no-op)
export function markIntroShown() {}
