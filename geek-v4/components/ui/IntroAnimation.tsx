import { useEffect } from 'react';
import { StyleSheet, Dimensions, Platform } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSequence,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import { FONT } from '@/design/typography';

// ============================================================
// Geek イントロ (シンプル版 2 フェーズ)
//   1. "Geek" の文字が白で静かに現れる
//   2. その後、紫のグローが広がる
//   3. ホールド → フェードアウト
// ============================================================

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const SHORTER = Math.min(SCREEN_W, SCREEN_H);

const CFG = {
  FONT_SIZE:        Math.round(Math.min(SHORTER * 0.28, 160)),
  LETTER_SPACING:   -2,
  BG_COLOR:         '#000000',
  LOGO_COLOR:       '#FFFFFF',
  GLOW_COLOR:       '#7C6AF7',

  // タイミング (ms)
  REVEAL_DURATION:  720,    // 文字フェードイン
  REVEAL_HOLD:      280,    // 文字だけのホールド
  GLOW_DURATION:    540,    // グロー拡大
  HOLD_DURATION:    760,    // 光った状態でホールド
  FADE_OUT_DURATION: 460,   // 全体フェードアウト
};

export function IntroAnimation({ onComplete }: { onComplete: () => void }) {
  // 0 → 1 で文字が現れる
  const textOpacity = useSharedValue(0);
  // 0 → 1 でグローが広がる
  const glowOpacity = useSharedValue(0);
  // 全体の不透明度 (フェードアウト用)
  const containerOpacity = useSharedValue(1);

  useEffect(() => {
    // フェーズ 1: 文字フェードイン
    textOpacity.value = withTiming(1, {
      duration: CFG.REVEAL_DURATION,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    });

    // フェーズ 2: 文字が出てしばらく後、グロー展開
    const glowStart = CFG.REVEAL_DURATION + CFG.REVEAL_HOLD;
    glowOpacity.value = withDelay(
      glowStart,
      withSequence(
        withTiming(1, { duration: CFG.GLOW_DURATION, easing: Easing.out(Easing.cubic) }),
        // ホールド
        withTiming(1, { duration: CFG.HOLD_DURATION }),
        // グローも一緒にフェードアウト
        withTiming(0, { duration: CFG.FADE_OUT_DURATION, easing: Easing.in(Easing.quad) }),
      ),
    );

    // 全体フェードアウト
    const fadeStart = glowStart + CFG.GLOW_DURATION + CFG.HOLD_DURATION;
    containerOpacity.value = withDelay(
      fadeStart,
      withTiming(0, { duration: CFG.FADE_OUT_DURATION, easing: Easing.in(Easing.quad) }, () => {
        runOnJS(onComplete)();
      }),
    );

    // Safety: 想定総尺 +1.5s で完了
    const total = fadeStart + CFG.FADE_OUT_DURATION + 1500;
    const safety = setTimeout(onComplete, total);
    return () => clearTimeout(safety);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: containerOpacity.value,
  }));

  const baseTextStyle = useAnimatedStyle(() => ({
    opacity: textOpacity.value,
  }));

  // 紫グロー: textShadow を使って広がる発光を表現
  const glowTextStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
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
        },
        containerStyle,
      ]}
    >
      {/* グロー層 (後ろ): 太い shadow で発光 */}
      <Animated.Text
        style={[
          baseLogo,
          {
            position: 'absolute',
            color: CFG.LOGO_COLOR,
            textShadowColor: CFG.GLOW_COLOR,
            textShadowRadius: 56,
            textShadowOffset: { width: 0, height: 0 },
            ...(Platform.OS === 'web'
              ? // Web は textShadow を強く重ねて発光感を出す
                ({
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  textShadow:
                    '0 0 28px #7C6AF7, 0 0 56px #7C6AF7, 0 0 96px #7C6AF7, 0 0 140px #7C6AF7',
                } as any)
              : {}),
          },
          glowTextStyle,
        ]}
      >
        Geek
      </Animated.Text>

      {/* 文字本体 (白) */}
      <Animated.Text style={[baseLogo, { color: CFG.LOGO_COLOR }, baseTextStyle]}>
        Geek
      </Animated.Text>
    </Animated.View>
  );
}

function baseLogoStyle() {
  const base = {
    fontFamily: FONT.display,
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
      WebkitFontSmoothing: 'antialiased',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      MozOsxFontSmoothing: 'grayscale',
      textRendering: 'geometricPrecision',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }
  return base;
}

// 旧 API 互換 (no-op)
export function markIntroShown() {}
