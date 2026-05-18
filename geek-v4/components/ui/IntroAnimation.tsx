import { useEffect } from 'react';
import { StyleSheet, Dimensions, Platform, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSequence,
  runOnJS,
  Easing,
} from 'react-native-reanimated';

// ============================================================
// Geek イントロ
//   1. G → e → e → k と一文字ずつ登場 (スタガード)
//   2. 全部出たら少しホールド
//   3. 紫グローが広がる
//   4. カメラがゆっくりズームイン (close-up)
//   5. フェードアウト
// フォント: Inter_900Black (太くて鋭い、Vercel/Linear/Stripe 系)
// ============================================================

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const SHORTER = Math.min(SCREEN_W, SCREEN_H);

const CFG = {
  // 文字: Inter Bold で参考画像の太さに合わせる + 控えめな文字間
  FONT_SIZE:       Math.round(Math.min(SHORTER * 0.26, 150)),
  LETTER_SPACING:  0,
  BG_COLOR:        '#000000',
  LOGO_COLOR:      '#FFFFFF',
  GLOW_COLOR:      '#7C6AF7',

  // タイミング (ms)
  LETTER_REVEAL:   420,    // 1文字あたりのフェードイン+リフト
  LETTER_STAGGER:  170,    // 次の文字までの間隔
  POST_LETTERS_HOLD: 320,  // 全文字揃ってからグロー開始まで
  GLOW_DURATION:   520,    // グロー拡大
  ZOOM_START_DELAY: 200,   // グロー開始からズーム開始まで
  ZOOM_DURATION:   1500,   // ズームイン尺
  HOLD_AT_PEAK:    260,    // ズーム最大の瞬間ホールド
  FADE_OUT:        500,    // 全体フェードアウト
};

const LETTERS = ['G', 'e', 'e', 'k'] as const;

export function IntroAnimation({ onComplete }: { onComplete: () => void }) {
  // 各文字の opacity / translateY
  const op0 = useSharedValue(0);
  const op1 = useSharedValue(0);
  const op2 = useSharedValue(0);
  const op3 = useSharedValue(0);
  const opacities = [op0, op1, op2, op3];

  const ty0 = useSharedValue(24);
  const ty1 = useSharedValue(24);
  const ty2 = useSharedValue(24);
  const ty3 = useSharedValue(24);
  const yOffsets = [ty0, ty1, ty2, ty3];

  // グロー (0→1 で広がる)
  const glow = useSharedValue(0);
  // 全体のスケール (1→1.45 でゆっくりズームイン)
  const zoom = useSharedValue(1);
  // コンテナ不透明度 (フェードアウト用)
  const containerOp = useSharedValue(1);

  useEffect(() => {
    // 1) 文字を一つずつ登場 (上から下に少し降りながらフェードイン)
    LETTERS.forEach((_, i) => {
      const delay = i * CFG.LETTER_STAGGER;
      opacities[i]!.value = withDelay(
        delay,
        withTiming(1, {
          duration: CFG.LETTER_REVEAL,
          easing: Easing.bezier(0.16, 1, 0.3, 1),
        }),
      );
      yOffsets[i]!.value = withDelay(
        delay,
        withTiming(0, {
          duration: CFG.LETTER_REVEAL,
          easing: Easing.bezier(0.16, 1, 0.3, 1),
        }),
      );
    });

    const allLettersDone = (LETTERS.length - 1) * CFG.LETTER_STAGGER + CFG.LETTER_REVEAL;

    // 2) グロー展開
    const glowStart = allLettersDone + CFG.POST_LETTERS_HOLD;
    glow.value = withDelay(
      glowStart,
      withSequence(
        withTiming(1, { duration: CFG.GLOW_DURATION, easing: Easing.out(Easing.cubic) }),
        // ズーム中もキープ → フェードと一緒に消える
        withTiming(1, { duration: CFG.ZOOM_DURATION + CFG.HOLD_AT_PEAK }),
        withTiming(0, { duration: CFG.FADE_OUT, easing: Easing.in(Easing.quad) }),
      ),
    );

    // 3) カメラズームイン (ゆっくり大きくなる)
    const zoomStart = glowStart + CFG.ZOOM_START_DELAY;
    zoom.value = withDelay(
      zoomStart,
      withTiming(1.45, {
        duration: CFG.ZOOM_DURATION,
        easing: Easing.bezier(0.45, 0.05, 0.55, 0.95),
      }),
    );

    // 4) 全体フェードアウト
    const fadeStart = zoomStart + CFG.ZOOM_DURATION + CFG.HOLD_AT_PEAK;
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
      <Animated.View style={[zoomStyle, { flexDirection: 'row', alignItems: 'baseline' }]}>
        {LETTERS.map((ch, i) => (
          <Letter
            key={i}
            ch={ch}
            opacity={opacities[i]!}
            translateY={yOffsets[i]!}
            glow={glow}
            baseStyle={baseLogo}
          />
        ))}
      </Animated.View>
    </Animated.View>
  );
}

function Letter({
  ch,
  opacity,
  translateY,
  glow,
  baseStyle,
}: {
  ch: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  opacity: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  translateY: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  glow: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  baseStyle: any;
}) {
  // 文字本体: 出現 + わずかに上から降りる
  const charStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  // グロー: 別レイヤーで重ねて textShadow を強化
  const glowStyle = useAnimatedStyle(() => ({
    opacity: opacity.value * glow.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <View style={{ position: 'relative' }}>
      {/* グロー層 (後ろ) */}
      <Animated.Text
        style={[
          baseStyle,
          {
            position: 'absolute',
            color: CFG.LOGO_COLOR,
            textShadowColor: CFG.GLOW_COLOR,
            textShadowRadius: 48,
            textShadowOffset: { width: 0, height: 0 },
            ...(Platform.OS === 'web'
              ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ({
                  textShadow:
                    '0 0 22px #7C6AF7, 0 0 48px #7C6AF7, 0 0 90px #7C6AF7, 0 0 140px #7C6AF7',
                } as any)
              : {}),
          },
          glowStyle,
        ]}
      >
        {ch}
      </Animated.Text>
      {/* 文字本体 (白、シャープ) */}
      <Animated.Text style={[baseStyle, { color: CFG.LOGO_COLOR }, charStyle]}>
        {ch}
      </Animated.Text>
    </View>
  );
}

function baseLogoStyle() {
  const base = {
    // 参考画像の重量感 (Inter Bold)
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
